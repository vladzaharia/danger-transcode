/**
 * Encoder profile system for danger-transcode
 * Provides hardware-specific FFmpeg configurations for different platforms
 */

import type {
  Config,
  EncodingProfile,
  HardwareProfile,
  HWAccelInputArgs,
  EncoderArgs,
  ScalerArgs,
  NvidiaEncoderSettings,
  RockchipEncoderSettings,
  SoftwareEncoderSettings,
} from './types.ts';
import { getLogger } from './logger.ts';

const logger = getLogger().child('encoder');

//═══════════════════════════════════════════════════════════════════════════════
// DEFAULT ENCODER SETTINGS
//═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_NVIDIA_SETTINGS: NvidiaEncoderSettings = {
  preset: 'p5',
  tune: 'hq',
  rcMode: 'vbr',
  lookahead: 20,
  temporalAq: true,
  spatialAq: false,
  aqStrength: 8,
  bFrames: 3,
  bRefMode: 'middle',
  gopSize: 250,
};

const DEFAULT_ROCKCHIP_SETTINGS: RockchipEncoderSettings = {
  rcMode: 'VBR',
  afbc: true,
  qp: 23,
};

const DEFAULT_SOFTWARE_SETTINGS: SoftwareEncoderSettings = {
  preset: 'medium',
  crf: 23,
  tune: 'none',
};

//═══════════════════════════════════════════════════════════════════════════════
// NVIDIA NVENC PROFILE
//═══════════════════════════════════════════════════════════════════════════════

function createNvidiaProfile(
  settings: NvidiaEncoderSettings,
  bitrate: string,
  maxBitrate: string,
): EncodingProfile {
  const hwAccelInput: HWAccelInputArgs = {
    hwaccel: 'cuda',
    hwaccelOutputFormat: 'cuda',
    extraInputArgs: ['-vsync', '0'],
  };

  const qualityArgs: string[] = [
    '-preset', settings.preset,
    '-tune', settings.tune,
  ];

  // Rate control
  if (settings.rcMode === 'vbr') {
    qualityArgs.push('-rc', 'vbr');
  } else if (settings.rcMode === 'cbr') {
    qualityArgs.push('-rc', 'cbr');
  } else {
    qualityArgs.push('-rc', 'constqp');
  }

  // Lookahead
  if (settings.lookahead > 0) {
    qualityArgs.push('-rc-lookahead', String(settings.lookahead));
  }

  // Adaptive quantization
  if (settings.temporalAq) {
    qualityArgs.push('-temporal-aq', '1');
  }
  if (settings.spatialAq) {
    qualityArgs.push('-spatial-aq', '1');
    qualityArgs.push('-aq-strength', String(settings.aqStrength));
  }

  // B-frames
  qualityArgs.push('-bf', String(settings.bFrames));
  if (settings.bFrames > 0) {
    qualityArgs.push('-b_ref_mode', settings.bRefMode);
  }

  // GOP size
  qualityArgs.push('-g', String(settings.gopSize));

  // Quality factors
  qualityArgs.push('-i_qfactor', '0.75', '-b_qfactor', '1.1');

  const encoder: EncoderArgs = {
    encoder: 'hevc_nvenc',
    bitrateArgs: ['-b:v', bitrate, '-maxrate', maxBitrate, '-bufsize', bitrate],
    qualityArgs,
  };

  return {
    name: 'nvidia',
    hwAccelInput,
    encoder,
    getScaler: (width: number, height: number): ScalerArgs => ({
      filter: `scale_cuda=${width}:${height}`,
      width,
      height,
    }),
  };
}

//═══════════════════════════════════════════════════════════════════════════════
// ROCKCHIP RKMPP PROFILE
//═══════════════════════════════════════════════════════════════════════════════

function createRockchipProfile(
  settings: RockchipEncoderSettings,
  bitrate: string,
  maxBitrate: string,
): EncodingProfile {
  const hwAccelInput: HWAccelInputArgs = {
    hwaccel: 'rkmpp',
    hwaccelOutputFormat: 'drm_prime',
    extraInputArgs: ['-afbc', 'rga'],
  };

  const qualityArgs: string[] = ['-rc_mode', settings.rcMode];
  if (settings.rcMode === 'CQP') {
    qualityArgs.push('-qp_init', String(settings.qp));
  }

  const encoder: EncoderArgs = {
    encoder: 'hevc_rkmpp',
    bitrateArgs: ['-b:v', bitrate, '-maxrate', maxBitrate],
    qualityArgs,
  };

  return {
    name: 'rockchip',
    hwAccelInput,
    encoder,
    getScaler: (width: number, height: number): ScalerArgs => {
      const afbcFlag = settings.afbc ? ':afbc=1' : '';
      return {
        filter: `scale_rkrga=w=${width}:h=${height}:format=nv12${afbcFlag}`,
        width,
        height,
      };
    },
  };
}

//═══════════════════════════════════════════════════════════════════════════════
// SOFTWARE x265 PROFILE
//═══════════════════════════════════════════════════════════════════════════════

function createSoftwareProfile(settings: SoftwareEncoderSettings): EncodingProfile {
  const hwAccelInput: HWAccelInputArgs = {
    // No hardware acceleration
  };

  const qualityArgs: string[] = ['-preset', settings.preset, '-crf', String(settings.crf)];

  if (settings.tune !== 'none') {
    qualityArgs.push('-tune', settings.tune);
  }

  const encoder: EncoderArgs = {
    encoder: 'libx265',
    bitrateArgs: [], // CRF mode, no explicit bitrate
    qualityArgs,
  };

  return {
    name: 'software',
    hwAccelInput,
    encoder,
    getScaler: (width: number, height: number): ScalerArgs => ({
      filter: `scale=${width}:${height}`,
      width,
      height,
    }),
  };
}

//═══════════════════════════════════════════════════════════════════════════════
// HARDWARE DETECTION
//═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect available hardware encoders by testing ffmpeg
 */
export async function detectHardwareProfile(ffmpegPath: string): Promise<HardwareProfile> {
  logger.debug('Auto-detecting hardware profile...');

  // Check for NVIDIA NVENC
  try {
    const nvencCheck = new Deno.Command(ffmpegPath, {
      args: ['-hide_banner', '-encoders'],
      stdout: 'piped',
      stderr: 'piped',
    });
    const { stdout } = await nvencCheck.output();
    const output = new TextDecoder().decode(stdout);

    if (output.includes('hevc_nvenc')) {
      logger.info('Detected NVIDIA NVENC hardware encoder');
      return 'nvidia';
    }
  } catch {
    // NVENC not available
  }

  // Check for Rockchip RKMPP
  try {
    const rkmppCheck = new Deno.Command(ffmpegPath, {
      args: ['-hide_banner', '-encoders'],
      stdout: 'piped',
      stderr: 'piped',
    });
    const { stdout } = await rkmppCheck.output();
    const output = new TextDecoder().decode(stdout);

    if (output.includes('hevc_rkmpp')) {
      logger.info('Detected Rockchip RKMPP hardware encoder');
      return 'rockchip';
    }
  } catch {
    // RKMPP not available
  }

  logger.info('No hardware encoder detected, using software encoding');
  return 'software';
}

//═══════════════════════════════════════════════════════════════════════════════
// PROFILE FACTORY
//═══════════════════════════════════════════════════════════════════════════════

/**
 * Get max bitrate (1.5x target for VBR headroom)
 */
function getMaxBitrate(bitrate: string): string {
  const match = bitrate.match(/^(\d+(?:\.\d+)?)\s*([KMG])?/i);
  if (!match) return bitrate;
  const value = parseFloat(match[1]) * 1.5;
  const unit = match[2] || '';
  return `${value}${unit}`;
}

/**
 * Get appropriate bitrate for target height
 */
export function getBitrateForHeight(height: number, config: Config): string {
  if (height <= 720) {
    return config.bitrates.low;
  } else if (height <= 1080) {
    return config.bitrates.medium;
  }
  return config.bitrates.high;
}

/**
 * Create encoding profile based on hardware type and config
 * @param bitrateOverride - Optional bitrate override from transcode list profile (e.g., "4M", "2500k")
 */
export async function createEncodingProfile(
  config: Config,
  targetHeight: number,
  bitrateOverride?: string,
): Promise<EncodingProfile> {
  let profile = config.hardwareProfile;

  // Auto-detect if needed
  if (profile === 'auto') {
    profile = await detectHardwareProfile(config.ffmpegPath);
  }

  // Use override bitrate if provided, otherwise calculate from height
  const bitrate = bitrateOverride ?? getBitrateForHeight(targetHeight, config);
  const maxBitrate = getMaxBitrate(bitrate);

  switch (profile) {
    case 'nvidia': {
      const settings = { ...DEFAULT_NVIDIA_SETTINGS, ...config.nvidia };
      return createNvidiaProfile(settings, bitrate, maxBitrate);
    }
    case 'rockchip': {
      const settings = { ...DEFAULT_ROCKCHIP_SETTINGS, ...config.rockchip };
      return createRockchipProfile(settings, bitrate, maxBitrate);
    }
    case 'software':
    default: {
      const settings = { ...DEFAULT_SOFTWARE_SETTINGS, ...config.software };
      return createSoftwareProfile(settings);
    }
  }
}

/**
 * Build complete FFmpeg arguments using encoding profile
 */
export function buildFFmpegArgsFromProfile(
  profile: EncodingProfile,
  inputPath: string,
  outputPath: string,
  targetWidth: number | null,
  targetHeight: number | null,
): string[] {
  const args: string[] = [];

  // Hardware acceleration input options
  if (profile.hwAccelInput.hwaccel) {
    args.push('-hwaccel', profile.hwAccelInput.hwaccel);
  }
  if (profile.hwAccelInput.hwaccelOutputFormat) {
    args.push('-hwaccel_output_format', profile.hwAccelInput.hwaccelOutputFormat);
  }
  if (profile.hwAccelInput.extraInputArgs) {
    args.push(...profile.hwAccelInput.extraInputArgs);
  }

  // Input file
  args.push('-i', inputPath);

  // Video encoder
  args.push('-c:v', profile.encoder.encoder);

  // Scaling filter (if needed)
  if (targetWidth && targetHeight) {
    const scaler = profile.getScaler(targetWidth, targetHeight);
    if (scaler) {
      args.push('-vf', scaler.filter);
    }
  }

  // Bitrate arguments
  args.push(...profile.encoder.bitrateArgs);

  // Quality arguments
  args.push(...profile.encoder.qualityArgs);

  // Audio: copy
  args.push('-c:a', 'copy');

  // Subtitles: copy
  args.push('-c:s', 'copy');

  // Map all streams
  args.push('-map', '0');

  // Overwrite output
  args.push('-y');

  // Output file
  args.push(outputPath);

  return args;
}


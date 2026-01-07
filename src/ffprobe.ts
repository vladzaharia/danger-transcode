/**
 * FFprobe module for danger-transcode
 * Extracts media information using ffprobe
 */

import type { Config, FFProbeOutput, VideoStreamInfo } from './types.ts';
import { getLogger } from './logger.ts';

const logger = getLogger().child('ffprobe');

/** Result of probing a media file */
export interface ProbeResult {
  path: string;
  video: VideoStreamInfo | null;
  hasAudio: boolean;
  hasSubtitles: boolean;
  duration: number;
  fileSize: number;
  formatName: string;
}

/**
 * Run ffprobe on a file and return parsed JSON output
 */
async function runFFprobe(ffprobePath: string, filePath: string): Promise<FFProbeOutput> {
  const command = new Deno.Command(ffprobePath, {
    args: [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ],
    stdout: 'piped',
    stderr: 'piped',
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(`ffprobe failed with code ${code}: ${errorText}`);
  }

  const outputText = new TextDecoder().decode(stdout);
  return JSON.parse(outputText) as FFProbeOutput;
}

/**
 * Probe a media file and extract relevant information
 */
export async function probeMediaFile(config: Config, filePath: string): Promise<ProbeResult> {
  logger.debug(`Probing: ${filePath}`);

  const output = await runFFprobe(config.ffprobePath, filePath);

  // Find video stream
  const videoStream = output.streams.find((s) => s.codec_type === 'video');
  const audioStream = output.streams.find((s) => s.codec_type === 'audio');
  const subtitleStream = output.streams.find((s) => s.codec_type === 'subtitle');

  // Get file size
  const fileInfo = await Deno.stat(filePath);
  const fileSize = fileInfo.size;

  // Parse duration
  const duration = output.format.duration ? parseFloat(output.format.duration) : 0;

  const result: ProbeResult = {
    path: filePath,
    video: null,
    hasAudio: !!audioStream,
    hasSubtitles: !!subtitleStream,
    duration,
    fileSize,
    formatName: output.format.format_name,
  };

  if (videoStream && videoStream.width && videoStream.height) {
    result.video = {
      codec_name: videoStream.codec_name,
      width: videoStream.width,
      height: videoStream.height,
      pix_fmt: videoStream.pix_fmt,
      bit_rate: videoStream.bit_rate,
      r_frame_rate: videoStream.r_frame_rate,
    };
  }

  return result;
}

/**
 * Check if a codec is HEVC/H.265
 */
export function isHEVC(codecName: string): boolean {
  const hevcNames = ['hevc', 'h265', 'x265', 'libx265'];
  return hevcNames.includes(codecName.toLowerCase());
}

/**
 * Get bitrate as a number (bits per second)
 */
export function parseBitrate(bitrateStr: string | undefined): number {
  if (!bitrateStr) return 0;

  const match = bitrateStr.match(/^(\d+(?:\.\d+)?)\s*([KMG])?/i);
  if (!match) return parseInt(bitrateStr, 10) || 0;

  let value = parseFloat(match[1]);
  const unit = match[2]?.toUpperCase();

  switch (unit) {
    case 'K':
      value *= 1000;
      break;
    case 'M':
      value *= 1000000;
      break;
    case 'G':
      value *= 1000000000;
      break;
  }

  return Math.round(value);
}

/**
 * Format bitrate for display
 */
export function formatBitrate(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1000000) {
    return `${(bitsPerSecond / 1000000).toFixed(1)} Mbps`;
  } else if (bitsPerSecond >= 1000) {
    return `${(bitsPerSecond / 1000).toFixed(0)} Kbps`;
  }
  return `${bitsPerSecond} bps`;
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1073741824) {
    return `${(bytes / 1073741824).toFixed(2)} GB`;
  } else if (bytes >= 1048576) {
    return `${(bytes / 1048576).toFixed(1)} MB`;
  } else if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${bytes} bytes`;
}

/**
 * Format duration for display
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

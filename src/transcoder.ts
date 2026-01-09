/**
 * Transcoder module for danger-transcode
 * Builds and executes FFmpeg commands with hardware acceleration support
 * Supports: NVIDIA NVENC, Rockchip RKMPP, Software (libx265)
 */

import { basename, dirname, join } from '@std/path';
import { ensureDir } from '@std/fs';
import type { Config, MediaFile, TranscodeRecord, EncodingProfile, OutputConfig } from './types.ts';
import { getLogger } from './logger.ts';
import { formatDuration, formatFileSize } from './ffprobe.ts';
import { createEncodingProfile, buildFFmpegArgsFromProfile } from './encoder.ts';

const logger = getLogger().child('transcoder');

/** Result of a transcode operation */
export interface TranscodeResult {
  success: boolean;
  record?: TranscodeRecord;
  error?: string;
  outputPath?: string;
}

/** Cached encoding profile for files without overrides */
let cachedProfile: EncodingProfile | null = null;
let cachedProfileHeight: number | null = null;
let cachedProfileBitrate: string | undefined = undefined;

/**
 * Get or create encoding profile (cached for performance)
 * Cache is invalidated if height or bitrate override changes
 */
async function getEncodingProfile(
  config: Config,
  targetHeight: number,
  bitrateOverride?: string,
): Promise<EncodingProfile> {
  // Cache profile if height and bitrate haven't changed
  if (
    cachedProfile &&
    cachedProfileHeight === targetHeight &&
    cachedProfileBitrate === bitrateOverride
  ) {
    return cachedProfile;
  }

  cachedProfile = await createEncodingProfile(config, targetHeight, bitrateOverride);
  cachedProfileHeight = targetHeight;
  cachedProfileBitrate = bitrateOverride;

  const bitrateInfo = bitrateOverride ? ` (bitrate: ${bitrateOverride})` : '';
  logger.info(`Using ${cachedProfile.name} encoder profile${bitrateInfo}`);
  return cachedProfile;
}

/**
 * Build FFmpeg command arguments using the encoder profile system
 * Uses per-file overrides from transcode list profiles when available
 */
export async function buildFFmpegArgs(
  inputPath: string,
  outputPath: string,
  file: MediaFile,
  config: Config,
): Promise<string[]> {
  const targetHeight = file.targetHeight ?? file.height;
  const bitrateOverride = file.overrides?.bitrate;
  const profile = await getEncodingProfile(config, targetHeight, bitrateOverride);

  // Determine if scaling is needed
  const needsScale = file.targetWidth !== file.width || file.targetHeight !== file.height;
  const targetWidth = needsScale ? file.targetWidth ?? null : null;
  const targetHeightForScale = needsScale ? file.targetHeight ?? null : null;

  return buildFFmpegArgsFromProfile(
    profile,
    inputPath,
    outputPath,
    targetWidth,
    targetHeightForScale,
  );
}

/**
 * Generate a temporary output path for transcoding
 */
export function getTempOutputPath(config: Config, inputPath: string): string {
  const fileName = basename(inputPath);
  const outputName = fileName.replace(/\.[^.]+$/, '.transcoding.mkv');
  return join(config.tempDir, outputName);
}

/**
 * Determine if we should replace the original file or output to a separate location
 * Priority: file overrides > config output settings > default (in-place)
 */
function shouldOutputInPlace(file: MediaFile, config: Config): boolean {
  // Per-file override from transcode list takes priority
  if (file.overrides?.inPlace !== undefined) {
    return file.overrides.inPlace;
  }
  // Use config output mode
  return config.output?.mode !== 'separate';
}

/**
 * Get the final output path for a transcoded file
 * For separate mode: constructs path in output directory
 * For in-place mode: same as input path (will replace original)
 */
async function getFinalOutputPath(
  file: MediaFile,
  config: Config,
): Promise<string> {
  const inPlace = shouldOutputInPlace(file, config);

  if (inPlace) {
    return file.path;
  }

  // Get output directory from override or config
  const outputDir = file.overrides?.outputDir ?? config.output?.directory;
  if (!outputDir) {
    logger.warn('Separate output mode but no output directory specified, using in-place');
    return file.path;
  }

  // Determine output path
  let finalOutputPath: string;

  if (config.output?.preserveStructure) {
    // Find which media dir this file is under
    const mediaDir = config.mediaDirs.find((dir) => file.path.startsWith(dir));
    if (mediaDir) {
      // Preserve structure relative to media dir
      const relativePath = file.path.slice(mediaDir.length);
      finalOutputPath = join(outputDir, relativePath);
    } else {
      // File not under any media dir, just use filename
      finalOutputPath = join(outputDir, basename(file.path));
    }
  } else {
    // Flat output - just filename in output dir
    finalOutputPath = join(outputDir, basename(file.path));
  }

  // Change extension to mkv
  finalOutputPath = finalOutputPath.replace(/\.[^.]+$/, '.mkv');

  // Ensure output directory exists
  await ensureDir(dirname(finalOutputPath));

  return finalOutputPath;
}

/**
 * Transcode a single media file
 */
export async function transcodeFile(
  file: MediaFile,
  config: Config,
): Promise<TranscodeResult> {
  const startTime = Date.now();
  const inPlace = shouldOutputInPlace(file, config);
  const profileInfo = file.overrides?.profileName ? ` [${file.overrides.profileName}]` : '';

  logger.info(`Starting transcode: ${file.path}${profileInfo}`);
  logger.info(
    `  ${file.codec} ${file.width}x${file.height} -> HEVC ${file.targetWidth}x${file.targetHeight}`,
  );
  if (file.overrides?.bitrate) {
    logger.info(`  Bitrate override: ${file.overrides.bitrate}`);
  }

  // Ensure temp directory exists
  await ensureDir(config.tempDir);

  // Generate temp output path
  const tempOutputPath = getTempOutputPath(config, file.path);

  // Build FFmpeg command
  const args = await buildFFmpegArgs(file.path, tempOutputPath, file, config);

  logger.debug(`FFmpeg command: ${config.ffmpegPath} ${args.join(' ')}`);

  if (config.dryRun) {
    logger.info('Dry run - skipping actual transcode');
    return { success: true };
  }

  try {
    // Run FFmpeg
    const command = new Deno.Command(config.ffmpegPath, {
      args,
      stdout: 'piped',
      stderr: 'piped',
    });

    const process = command.spawn();
    const { code, stderr } = await process.output();

    if (code !== 0) {
      const errorText = new TextDecoder().decode(stderr);
      throw new Error(`FFmpeg exited with code ${code}: ${errorText}`);
    }

    // Get file sizes
    const originalStat = await Deno.stat(file.path);
    const newStat = await Deno.stat(tempOutputPath);

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    const sizeReduction = Math.round((1 - newStat.size / originalStat.size) * 100);

    logger.info(`Transcode complete: ${formatDuration(duration)}`);
    logger.info(
      `  Size: ${formatFileSize(originalStat.size)} -> ${
        formatFileSize(newStat.size)
      } (${sizeReduction}% ${sizeReduction >= 0 ? 'reduction' : 'increase'})`,
    );

    // Determine final output path
    const finalOutputPath = await getFinalOutputPath(file, config);

    // For in-place mode, only replace if smaller
    // For separate mode, always output (user explicitly wants separate copies)
    if (inPlace && newStat.size >= originalStat.size) {
      logger.warn(
        `Skipping replacement: transcoded file is not smaller (${formatFileSize(newStat.size)} >= ${
          formatFileSize(originalStat.size)
        })`,
      );
      // Clean up temp file
      await Deno.remove(tempOutputPath);
      return {
        success: true,
        record: {
          originalPath: file.path,
          transcodedAt: new Date().toISOString(),
          originalCodec: file.codec,
          originalWidth: file.width,
          originalHeight: file.height,
          newWidth: file.width, // Kept original
          newHeight: file.height, // Kept original
          originalSize: originalStat.size,
          newSize: originalStat.size, // Kept original
          duration,
          success: true,
          error: 'Transcoded file was not smaller - kept original',
        },
      };
    }

    // Move transcoded file to final location
    if (inPlace) {
      // Replace original file with transcoded version
      await replaceOriginalFile(file.path, tempOutputPath);
      logger.info(`  Replaced original file`);
    } else {
      // Move to separate output location
      await moveFile(tempOutputPath, finalOutputPath);
      logger.info(`  Output: ${finalOutputPath}`);
    }

    // Create transcode record
    const record: TranscodeRecord = {
      originalPath: file.path,
      transcodedAt: new Date().toISOString(),
      originalCodec: file.codec,
      originalWidth: file.width,
      originalHeight: file.height,
      newWidth: file.targetWidth ?? file.width,
      newHeight: file.targetHeight ?? file.height,
      originalSize: originalStat.size,
      newSize: newStat.size,
      duration,
      success: true,
    };

    return { success: true, record, outputPath: inPlace ? file.path : finalOutputPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Transcode failed: ${file.path}`, errorMessage);

    // Clean up temp file if it exists
    try {
      await Deno.remove(tempOutputPath);
    } catch {
      // Ignore cleanup errors
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Move a file, handling cross-filesystem moves by falling back to copy+delete
 */
async function moveFile(src: string, dest: string): Promise<void> {
  try {
    // Try rename first (fast, same filesystem)
    await Deno.rename(src, dest);
  } catch (error) {
    // Check if it's a cross-device error (EXDEV)
    if (error instanceof Error && error.message.includes('cross-device')) {
      // Fall back to copy + delete
      await Deno.copyFile(src, dest);
      await Deno.remove(src);
    } else {
      throw error;
    }
  }
}

/**
 * Replace the original file with the transcoded version
 * Preserves file permissions and timestamps where possible
 */
async function replaceOriginalFile(
  originalPath: string,
  transcodedPath: string,
): Promise<void> {
  // Create backup path (in case we need to recover)
  const backupPath = originalPath + '.backup';

  try {
    // Rename original to backup (same filesystem, should always work)
    await Deno.rename(originalPath, backupPath);

    // Move transcoded file to original location (may be cross-filesystem)
    await moveFile(transcodedPath, originalPath);

    // Remove backup
    await Deno.remove(backupPath);

    logger.debug(`Replaced original file: ${originalPath}`);
  } catch (error) {
    // Try to restore backup if something went wrong
    try {
      await Deno.rename(backupPath, originalPath);
    } catch {
      // Backup restore failed too
    }
    throw error;
  }
}

/**
 * Estimate transcode time based on duration and resolution
 */
export function estimateTranscodeTime(
  durationSeconds: number,
  height: number,
  useHardwareAccel: boolean,
): number {
  // Rough estimates based on RK3588 performance
  // Hardware: ~2-4x realtime for 1080p HEVC
  // Software: ~0.1-0.5x realtime depending on preset

  let speedFactor: number;

  if (useHardwareAccel) {
    if (height <= 720) {
      speedFactor = 4.0; // 4x realtime for 720p
    } else if (height <= 1080) {
      speedFactor = 2.5; // 2.5x realtime for 1080p
    } else {
      speedFactor = 1.0; // 1x realtime for 4K
    }
  } else {
    speedFactor = 0.3; // Software encoding is much slower
  }

  return durationSeconds / speedFactor;
}

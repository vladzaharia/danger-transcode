/**
 * Transcoder module for danger-transcode
 * Builds and executes FFmpeg commands with Rockchip hardware acceleration
 */

import { basename, join } from '@std/path';
import { ensureDir } from '@std/fs';
import type { Config, MediaFile, TranscodeRecord } from './types.ts';
import { getLogger } from './logger.ts';
import { formatDuration, formatFileSize } from './ffprobe.ts';

const logger = getLogger().child('transcoder');

/** Result of a transcode operation */
export interface TranscodeResult {
  success: boolean;
  record?: TranscodeRecord;
  error?: string;
}

/**
 * Get appropriate bitrate for the target resolution
 */
function getBitrate(height: number, config: Config): string {
  if (height <= 720) {
    return config.bitrates.low;
  } else if (height <= 1080) {
    return config.bitrates.medium;
  }
  return config.bitrates.high;
}

/**
 * Get max bitrate (typically 1.5x the target bitrate for VBR)
 */
function getMaxBitrate(bitrate: string): string {
  const match = bitrate.match(/^(\d+(?:\.\d+)?)\s*([KMG])?/i);
  if (!match) return bitrate;

  const value = parseFloat(match[1]) * 1.5;
  const unit = match[2] || '';
  return `${value}${unit}`;
}

/**
 * Build FFmpeg command arguments for hardware-accelerated transcoding
 */
export function buildFFmpegArgs(
  inputPath: string,
  outputPath: string,
  file: MediaFile,
  config: Config,
): string[] {
  const args: string[] = [];

  // Hardware acceleration input options (Rockchip MPP)
  if (config.useHardwareAccel) {
    args.push('-hwaccel', 'rkmpp');
    args.push('-hwaccel_output_format', 'drm_prime');
    args.push('-afbc', 'rga');
  }

  // Input file
  args.push('-i', inputPath);

  // Video encoding
  const bitrate = getBitrate(file.targetHeight ?? file.height, config);
  const maxBitrate = getMaxBitrate(bitrate);

  // Video filter for scaling (if needed)
  const needsScale = file.targetWidth !== file.width || file.targetHeight !== file.height;

  if (config.useHardwareAccel) {
    // Hardware-accelerated encoder
    args.push('-c:v', 'hevc_rkmpp');

    if (needsScale) {
      // Use hardware scaler
      args.push(
        '-vf',
        `scale_rkrga=w=${file.targetWidth}:h=${file.targetHeight}:format=nv12:afbc=1`,
      );
    }

    // Encoder settings
    args.push('-rc_mode', 'VBR');
    args.push('-b:v', bitrate);
    args.push('-maxrate', maxBitrate);
  } else {
    // Software fallback (libx265)
    args.push('-c:v', 'libx265');
    args.push('-preset', 'medium');
    args.push('-crf', '23');

    if (needsScale) {
      args.push('-vf', `scale=${file.targetWidth}:${file.targetHeight}`);
    }
  }

  // Audio: copy if possible
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

/**
 * Generate a temporary output path for transcoding
 */
export function getTempOutputPath(config: Config, inputPath: string): string {
  const fileName = basename(inputPath);
  const outputName = fileName.replace(/\.[^.]+$/, '.transcoding.mkv');
  return join(config.tempDir, outputName);
}

/**
 * Transcode a single media file
 */
export async function transcodeFile(
  file: MediaFile,
  config: Config,
): Promise<TranscodeResult> {
  const startTime = Date.now();
  logger.info(`Starting transcode: ${file.path}`);
  logger.info(
    `  ${file.codec} ${file.width}x${file.height} -> HEVC ${file.targetWidth}x${file.targetHeight}`,
  );

  // Ensure temp directory exists
  await ensureDir(config.tempDir);

  // Generate temp output path
  const tempOutputPath = getTempOutputPath(config, file.path);

  // Build FFmpeg command
  const args = buildFFmpegArgs(file.path, tempOutputPath, file, config);

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

    // Only replace if the new file is smaller
    if (newStat.size >= originalStat.size) {
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

    // Replace original file with transcoded version
    await replaceOriginalFile(file.path, tempOutputPath);

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

    return { success: true, record };
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

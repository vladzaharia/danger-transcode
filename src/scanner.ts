/**
 * Media scanner module for danger-transcode
 * Discovers and classifies media files in configured directories
 */

import { walk } from '@std/fs';
import { basename, dirname, extname } from '@std/path';
import type { Config, MediaFile, MediaType, TranscodeDatabase } from './types.ts';
import { isHEVC, probeMediaFile } from './ffprobe.ts';
import { getFileErrors, isFileTranscoded } from './database.ts';
import { getLogger } from './logger.ts';

const logger = getLogger().child('scanner');

/** Patterns indicating TV show content */
const TV_PATTERNS = [
  /[Ss]\d{1,2}[Ee]\d{1,2}/, // S01E01, s1e2
  /\d{1,2}x\d{1,2}/, // 1x01, 01x01
  /[Ss]eason\s*\d+/i, // Season 1
  /[Ee]pisode\s*\d+/i, // Episode 1
];

/** Folder names indicating TV shows */
const TV_FOLDER_PATTERNS = [
  /tv\s*shows?/i,
  /series/i,
  /seasons?/i,
  /episodes?/i,
];

/** Folder names indicating movies */
const MOVIE_FOLDER_PATTERNS = [
  /movies?/i,
  /films?/i,
];

/**
 * Classify a media file based on its path
 */
export function classifyMediaType(filePath: string): MediaType {
  const fileName = basename(filePath);
  const dirPath = dirname(filePath);
  const pathParts = dirPath.toLowerCase().split('/');

  // Check filename for TV show patterns
  for (const pattern of TV_PATTERNS) {
    if (pattern.test(fileName)) {
      return 'tv';
    }
  }

  // Check path for TV folder patterns
  for (const part of pathParts) {
    for (const pattern of TV_FOLDER_PATTERNS) {
      if (pattern.test(part)) {
        return 'tv';
      }
    }
  }

  // Check path for movie folder patterns
  for (const part of pathParts) {
    for (const pattern of MOVIE_FOLDER_PATTERNS) {
      if (pattern.test(part)) {
        return 'movie';
      }
    }
  }

  // Default to 'other' for web series, YouTube downloads, etc.
  return 'other';
}

/**
 * Check if a file extension is a supported video format
 */
export function isVideoFile(filePath: string, config: Config): boolean {
  const ext = extname(filePath).toLowerCase();
  return config.videoExtensions.includes(ext);
}

/**
 * Calculate target resolution based on media type and config
 * Returns null if no scaling is needed
 */
export function calculateTargetResolution(
  width: number,
  height: number,
  mediaType: MediaType,
  config: Config,
): { width: number; height: number } | null {
  let maxHeight: number;

  switch (mediaType) {
    case 'tv':
      maxHeight = config.tvMaxHeight;
      break;
    case 'movie':
      maxHeight = config.movieMaxHeight;
      break;
    case 'other':
      // Keep original resolution for other content
      return null;
  }

  // Don't upscale
  if (height <= maxHeight) {
    return null;
  }

  // Calculate new dimensions preserving aspect ratio
  const aspectRatio = width / height;
  const newHeight = maxHeight;
  // Ensure width is even (required for most codecs)
  const newWidth = Math.floor((newHeight * aspectRatio) / 2) * 2;

  return { width: newWidth, height: newHeight };
}

/**
 * Scan a single media file and determine if it needs transcoding
 */
async function scanFile(
  filePath: string,
  config: Config,
  db: TranscodeDatabase,
): Promise<MediaFile | null> {
  // Skip if already transcoded
  if (isFileTranscoded(db, filePath)) {
    logger.debug(`Skipping (already transcoded): ${filePath}`);
    return null;
  }

  // Check for previous errors (skip if too many attempts)
  const errorRecord = getFileErrors(db, filePath);
  if (errorRecord && errorRecord.attempts >= 3) {
    logger.debug(`Skipping (too many errors): ${filePath}`);
    return null;
  }

  try {
    const probe = await probeMediaFile(config, filePath);

    if (!probe.video) {
      logger.warn(`No video stream found: ${filePath}`);
      return null;
    }

    const mediaType = classifyMediaType(filePath);
    const isAlreadyHEVC = isHEVC(probe.video.codec_name);

    // Determine if transcoding is needed
    let needsTranscode = !isAlreadyHEVC;
    let skipReason: string | undefined;

    if (isAlreadyHEVC) {
      skipReason = 'Already HEVC';
      needsTranscode = false;
    }

    // Calculate target resolution
    const target = calculateTargetResolution(
      probe.video.width,
      probe.video.height,
      mediaType,
      config,
    );

    // If already HEVC but needs scaling, we should still transcode
    if (target && isAlreadyHEVC) {
      needsTranscode = true;
      skipReason = undefined;
    }

    return {
      path: filePath,
      type: mediaType,
      codec: probe.video.codec_name,
      width: probe.video.width,
      height: probe.video.height,
      duration: probe.duration,
      needsTranscode,
      skipReason,
      targetWidth: target?.width ?? probe.video.width,
      targetHeight: target?.height ?? probe.video.height,
    };
  } catch (error) {
    logger.error(`Error probing file: ${filePath}`, error);
    return null;
  }
}

/** Scan results */
export interface ScanResult {
  totalFiles: number;
  toTranscode: MediaFile[];
  skipped: { path: string; reason: string }[];
  errors: string[];
}

/**
 * Scan all configured media directories for files to transcode
 */
export async function scanMediaDirectories(
  config: Config,
  db: TranscodeDatabase,
): Promise<ScanResult> {
  const result: ScanResult = {
    totalFiles: 0,
    toTranscode: [],
    skipped: [],
    errors: [],
  };

  for (const mediaDir of config.mediaDirs) {
    logger.info(`Scanning directory: ${mediaDir}`);

    try {
      // Check if directory exists
      const stat = await Deno.stat(mediaDir);
      if (!stat.isDirectory) {
        logger.warn(`Not a directory: ${mediaDir}`);
        continue;
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        logger.warn(`Directory not found: ${mediaDir}`);
        continue;
      }
      throw error;
    }

    // Walk directory recursively
    for await (
      const entry of walk(mediaDir, {
        includeDirs: false,
        followSymlinks: false,
      })
    ) {
      // Skip non-video files
      if (!isVideoFile(entry.path, config)) {
        continue;
      }

      result.totalFiles++;

      // Scan the file
      const mediaFile = await scanFile(entry.path, config, db);

      if (!mediaFile) {
        result.errors.push(entry.path);
        continue;
      }

      if (mediaFile.needsTranscode) {
        result.toTranscode.push(mediaFile);
        logger.debug(
          `To transcode: ${mediaFile.path} (${mediaFile.codec} ${mediaFile.width}x${mediaFile.height} -> ${mediaFile.targetWidth}x${mediaFile.targetHeight})`,
        );
      } else {
        result.skipped.push({
          path: mediaFile.path,
          reason: mediaFile.skipReason ?? 'Unknown',
        });
      }
    }
  }

  logger.info(
    `Scan complete: ${result.totalFiles} files, ${result.toTranscode.length} to transcode, ${result.skipped.length} skipped`,
  );

  return result;
}

/**
 * Get a summary of media types found
 */
export function summarizeByType(files: MediaFile[]): Record<MediaType, number> {
  const summary: Record<MediaType, number> = { tv: 0, movie: 0, other: 0 };

  for (const file of files) {
    summary[file.type]++;
  }

  return summary;
}

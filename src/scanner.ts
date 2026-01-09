/**
 * Media scanner module for danger-transcode
 * Split into two phases:
 * 1. Discovery - find video files in directories
 * 2. Analysis - probe files and determine transcoding needs
 */

import { walk } from '@std/fs';
import { basename, dirname, extname } from '@std/path';
import type { Config, MediaFile, MediaType, TranscodeDatabase, TranscodeOverrides } from './types.ts';
import type { AnalysisDatabase, AnalysisRecord } from './schemas.ts';
import { isHEVC, probeMediaFile, type ProbeResult } from './ffprobe.ts';
import {
  getFileErrors,
  isFileTranscoded,
  getCachedAnalysis,
  setAnalysisRecord,
  getFileIdentifier,
} from './database.ts';
import { getLogger } from './logger.ts';

const logger = getLogger().child('scanner');

//═══════════════════════════════════════════════════════════════════════════════
// CLASSIFICATION PATTERNS
//═══════════════════════════════════════════════════════════════════════════════

/** Patterns indicating TV show content */
const TV_PATTERNS = [
  /[Ss]\d{1,2}[Ee]\d{1,2}/, // S01E01, s1e2
  /\d{1,2}x\d{1,2}/, // 1x01, 01x01
  /[Ss]eason\s*\d+/i, // Season 1
  /[Ee]pisode\s*\d+/i, // Episode 1
];

/** Folder names indicating TV shows */
const TV_FOLDER_PATTERNS = [/tv\s*shows?/i, /series/i, /seasons?/i, /episodes?/i];

/** Folder names indicating movies */
const MOVIE_FOLDER_PATTERNS = [/movies?/i, /films?/i];

//═══════════════════════════════════════════════════════════════════════════════
// EXCLUSION SYSTEM
//═══════════════════════════════════════════════════════════════════════════════

/** Result of checking exclusion rules */
export interface ExclusionCheck {
  excluded: boolean;
  reason?: string;
}

/**
 * Check if a file should be excluded based on configured rules
 */
export function checkExclusions(filePath: string, config: Config): ExclusionCheck {
  const exclusions = config.exclusions;
  if (!exclusions) {
    return { excluded: false };
  }

  const pathLower = filePath.toLowerCase();
  const fileName = basename(filePath);
  const pathParts = filePath.split('/').map((p) => p.toLowerCase());

  // Check directory exclusions
  if (exclusions.directories?.length) {
    for (const dir of exclusions.directories) {
      const dirLower = dir.toLowerCase();
      if (pathParts.includes(dirLower)) {
        return { excluded: true, reason: `Directory excluded: ${dir}` };
      }
    }
  }

  // Check pathContains (simple string match)
  if (exclusions.pathContains?.length) {
    for (const needle of exclusions.pathContains) {
      if (pathLower.includes(needle.toLowerCase())) {
        return { excluded: true, reason: `Path contains: ${needle}` };
      }
    }
  }

  // Check path patterns (regex against full path)
  if (exclusions.pathPatterns?.length) {
    for (const pattern of exclusions.pathPatterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(filePath)) {
          return { excluded: true, reason: `Path matches pattern: ${pattern}` };
        }
      } catch {
        logger.warn(`Invalid regex pattern: ${pattern}`);
      }
    }
  }

  // Check file patterns (regex against filename only)
  if (exclusions.filePatterns?.length) {
    for (const pattern of exclusions.filePatterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(fileName)) {
          return { excluded: true, reason: `Filename matches pattern: ${pattern}` };
        }
      } catch {
        logger.warn(`Invalid regex pattern: ${pattern}`);
      }
    }
  }

  return { excluded: false };
}

//═══════════════════════════════════════════════════════════════════════════════
// DISCOVERY PHASE - Find video files
//═══════════════════════════════════════════════════════════════════════════════

/** A discovered file before analysis */
export interface DiscoveredFile {
  path: string;
  size: number;
}

/** Result of the discovery phase */
export interface DiscoveryResult {
  files: DiscoveredFile[];
  excluded: { path: string; reason: string }[];
  skippedDirs: string[];
  totalSize: number;
}

/**
 * Check if a file extension is a supported video format
 */
export function isVideoFile(filePath: string, config: Config): boolean {
  const ext = extname(filePath).toLowerCase();
  return config.videoExtensions.includes(ext);
}

/** Internal result from scanning a directory */
interface DirectoryScanResult {
  files: DiscoveredFile[];
  excluded: { path: string; reason: string }[];
  skippedDirs: string[];
}

/**
 * Build a regex to skip excluded directories during walk
 */
function buildDirectorySkipRegex(config: Config): RegExp | undefined {
  const directories = config.exclusions?.directories;
  if (!directories?.length) {
    return undefined;
  }

  // Build regex that matches any path containing an excluded directory component
  // Escape special regex chars and join with |
  const escaped = directories.map((d) => d.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  // Match directory name as a path component (between slashes or at end)
  // Case-insensitive matching
  const pattern = `(?:^|/)(?:${escaped.join('|')})(?:/|$)`;
  return new RegExp(pattern, 'i');
}

/**
 * Discover all video files in a single directory (recursive)
 */
async function discoverDirectory(dirPath: string, config: Config): Promise<DirectoryScanResult> {
  const files: DiscoveredFile[] = [];
  const excluded: { path: string; reason: string }[] = [];
  const skippedDirs: string[] = [];

  // Build skip regex for directories
  const skipRegex = buildDirectorySkipRegex(config);

  for await (
    const entry of walk(dirPath, {
      includeDirs: false,
      followSymlinks: false,
      // Skip entire directory trees that match exclusion patterns
      skip: skipRegex ? [skipRegex] : undefined,
    })
  ) {
    if (!isVideoFile(entry.path, config)) {
      continue;
    }

    // Check non-directory exclusion rules (pathPatterns, filePatterns, pathContains)
    const exclusionCheck = checkExclusions(entry.path, config);
    if (exclusionCheck.excluded) {
      excluded.push({ path: entry.path, reason: exclusionCheck.reason ?? 'Excluded' });
      logger.debug(`Excluded: ${entry.path} (${exclusionCheck.reason})`);
      continue;
    }

    try {
      const stat = await Deno.stat(entry.path);
      files.push({
        path: entry.path,
        size: stat.size,
      });
    } catch {
      // Skip files we can't stat
      logger.debug(`Cannot stat file: ${entry.path}`);
    }
  }

  return { files, excluded, skippedDirs };
}

/**
 * Discover all video files in configured media directories
 * This is a fast operation - no ffprobe calls, just filesystem traversal
 */
export async function discoverMediaFiles(config: Config): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    files: [],
    excluded: [],
    skippedDirs: [],
    totalSize: 0,
  };

  for (const mediaDir of config.mediaDirs) {
    logger.info(`Discovering files in: ${mediaDir}`);

    try {
      const stat = await Deno.stat(mediaDir);
      if (!stat.isDirectory) {
        logger.warn(`Not a directory: ${mediaDir}`);
        result.skippedDirs.push(mediaDir);
        continue;
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        logger.warn(`Directory not found: ${mediaDir}`);
        result.skippedDirs.push(mediaDir);
        continue;
      }
      throw error;
    }

    const dirResult = await discoverDirectory(mediaDir, config);
    result.files.push(...dirResult.files);
    result.excluded.push(...dirResult.excluded);
  }

  result.totalSize = result.files.reduce((sum, f) => sum + f.size, 0);

  if (result.excluded.length > 0) {
    logger.info(
      `Discovery complete: ${result.files.length} video files found, ${result.excluded.length} excluded`,
    );
  } else {
    logger.info(`Discovery complete: ${result.files.length} video files found`);
  }

  return result;
}

//═══════════════════════════════════════════════════════════════════════════════
// CLASSIFICATION HELPERS
//═══════════════════════════════════════════════════════════════════════════════

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
 * Calculate target resolution based on media type and config
 * Returns null if no scaling is needed
 * @param maxHeightOverride - Optional override from transcode list profile
 */
export function calculateTargetResolution(
  width: number,
  height: number,
  mediaType: MediaType,
  config: Config,
  maxHeightOverride?: number,
): { width: number; height: number } | null {
  let maxHeight: number;

  if (maxHeightOverride !== undefined) {
    // Use profile override
    maxHeight = maxHeightOverride;
  } else {
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

//═══════════════════════════════════════════════════════════════════════════════
// ANALYSIS PHASE - Probe files and determine transcoding needs
//═══════════════════════════════════════════════════════════════════════════════

/** Result of analyzing a single file */
export interface AnalysisResult {
  file: MediaFile | null;
  skipped: boolean;
  skipReason?: string;
  error?: string;
}

/** Result of the full analysis phase */
export interface AnalysisSummary {
  totalAnalyzed: number;
  toTranscode: MediaFile[];
  skipped: { path: string; reason: string }[];
  errors: { path: string; error: string }[];
}

/**
 * Filter discovered files based on database state
 * Returns files that haven't been transcoded and haven't failed too many times
 */
export function filterByDatabaseState(
  files: DiscoveredFile[],
  db: TranscodeDatabase,
): { toAnalyze: DiscoveredFile[]; alreadyDone: string[]; tooManyErrors: string[] } {
  const toAnalyze: DiscoveredFile[] = [];
  const alreadyDone: string[] = [];
  const tooManyErrors: string[] = [];

  for (const file of files) {
    if (isFileTranscoded(db, file.path)) {
      alreadyDone.push(file.path);
      continue;
    }

    const errorRecord = getFileErrors(db, file.path);
    if (errorRecord && errorRecord.attempts >= 3) {
      tooManyErrors.push(file.path);
      continue;
    }

    toAnalyze.push(file);
  }

  return { toAnalyze, alreadyDone, tooManyErrors };
}

/**
 * Convert a cached AnalysisRecord back to ProbeResult format
 */
function analysisRecordToProbeResult(record: AnalysisRecord): ProbeResult {
  return {
    path: record.path,
    video: record.video
      ? {
          codec_name: record.video.codec_name,
          width: record.video.width,
          height: record.video.height,
          bit_rate: record.video.bit_rate,
        }
      : null,
    hasAudio: record.hasAudio,
    hasSubtitles: record.hasSubtitles,
    duration: record.duration,
    fileSize: record.fileSize,
    formatName: record.formatName,
  };
}

/**
 * Convert a ProbeResult to AnalysisRecord for caching
 */
async function probeResultToAnalysisRecord(
  probe: ProbeResult,
  filePath: string,
): Promise<AnalysisRecord | null> {
  const fileId = await getFileIdentifier(filePath);
  if (!fileId) return null;

  return {
    path: filePath,
    fileSize: fileId.size,
    fileMtime: fileId.mtime,
    analyzedAt: new Date().toISOString(),
    video: probe.video
      ? {
          codec_name: probe.video.codec_name,
          width: probe.video.width,
          height: probe.video.height,
          bit_rate: probe.video.bit_rate,
        }
      : null,
    hasAudio: probe.hasAudio,
    hasSubtitles: probe.hasSubtitles,
    duration: probe.duration,
    formatName: probe.formatName,
  };
}

/** Options for analyzeFile function */
export interface AnalyzeFileOptions {
  /** Optional overrides from transcode list profile */
  overrides?: TranscodeOverrides;
  /** Optional analysis database for caching */
  analysisDb?: AnalysisDatabase;
}

/**
 * Analyze a single file to determine if it needs transcoding
 * Uses cached analysis if available and valid, otherwise calls ffprobe
 */
export async function analyzeFile(
  filePath: string,
  config: Config,
  options?: AnalyzeFileOptions,
): Promise<AnalysisResult> {
  const { overrides, analysisDb } = options ?? {};

  try {
    let probe: ProbeResult;
    let cacheHit = false;

    // Try to get cached analysis
    if (analysisDb) {
      const cached = await getCachedAnalysis(analysisDb, filePath);
      if (cached) {
        probe = analysisRecordToProbeResult(cached);
        cacheHit = true;
        logger.debug(`Analysis cache hit: ${filePath}`);
      } else {
        // Cache miss - run ffprobe
        probe = await probeMediaFile(config, filePath);

        // Store in cache
        const record = await probeResultToAnalysisRecord(probe, filePath);
        if (record) {
          setAnalysisRecord(analysisDb, record);
        }
      }
    } else {
      // No cache - just run ffprobe
      probe = await probeMediaFile(config, filePath);
    }

    if (!probe.video) {
      return {
        file: null,
        skipped: true,
        skipReason: 'No video stream',
      };
    }

    const mediaType = classifyMediaType(filePath);
    const isAlreadyHEVC = isHEVC(probe.video.codec_name);

    // Calculate target resolution (null if no scaling needed)
    // Use override maxHeight if provided from transcode list profile
    const target = calculateTargetResolution(
      probe.video.width,
      probe.video.height,
      mediaType,
      config,
      overrides?.maxHeight,
    );
    const needsScaling = target !== null;

    // Determine if transcoding is needed:
    // - Not HEVC → needs transcode (to convert to HEVC)
    // - HEVC but too high resolution → needs transcode (to scale down)
    // - HEVC at/below target resolution → skip (already optimal)
    let needsTranscode = false;
    let skipReason: string | undefined;

    if (!isAlreadyHEVC) {
      // Need to convert to HEVC
      needsTranscode = true;
    } else if (needsScaling) {
      // Already HEVC but resolution too high - need to scale down
      needsTranscode = true;
    } else {
      // Already HEVC and at/below target resolution - skip
      needsTranscode = false;
      skipReason = `Already HEVC at ${probe.video.height}p`;
    }

    const mediaFile: MediaFile = {
      path: filePath,
      type: mediaType,
      codec: probe.video.codec_name,
      width: probe.video.width,
      height: probe.video.height,
      size: probe.fileSize,
      duration: probe.duration,
      needsTranscode,
      skipReason,
      targetWidth: target?.width ?? probe.video.width,
      targetHeight: target?.height ?? probe.video.height,
      overrides, // Attach overrides for use during transcoding
    };

    return {
      file: mediaFile,
      skipped: !needsTranscode,
      skipReason,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error probing file: ${filePath}`, errorMessage);
    return {
      file: null,
      skipped: false,
      error: errorMessage,
    };
  }
}

/**
 * Analyze multiple files with progress callback
 * @param analysisDb - Optional analysis database for caching ffprobe results
 */
export async function analyzeFiles(
  files: DiscoveredFile[],
  config: Config,
  onProgress?: (current: number, total: number, path: string) => void,
  analysisDb?: AnalysisDatabase,
): Promise<AnalysisSummary> {
  const summary: AnalysisSummary = {
    totalAnalyzed: 0,
    toTranscode: [],
    skipped: [],
    errors: [],
  };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i + 1, files.length, file.path);

    const result = await analyzeFile(file.path, config, { analysisDb });
    summary.totalAnalyzed++;

    if (result.error) {
      summary.errors.push({ path: file.path, error: result.error });
    } else if (result.file) {
      if (result.file.needsTranscode) {
        summary.toTranscode.push(result.file);
        logger.debug(
          `To transcode: ${result.file.path} (${result.file.codec} ${result.file.width}x${result.file.height} -> ${result.file.targetWidth}x${result.file.targetHeight})`,
        );
      } else {
        summary.skipped.push({
          path: result.file.path,
          reason: result.skipReason ?? 'Unknown',
        });
      }
    } else if (result.skipped) {
      summary.skipped.push({
        path: file.path,
        reason: result.skipReason ?? 'Unknown',
      });
    }
  }

  logger.info(
    `Analysis complete: ${summary.totalAnalyzed} files, ${summary.toTranscode.length} to transcode, ${summary.skipped.length} skipped`,
  );

  return summary;
}

//═══════════════════════════════════════════════════════════════════════════════
// COMBINED SCAN (Discovery + Analysis)
//═══════════════════════════════════════════════════════════════════════════════

/** Combined scan results */
export interface ScanResult {
  totalFiles: number;
  toTranscode: MediaFile[];
  skipped: { path: string; reason: string }[];
  excluded: { path: string; reason: string }[];
  errors: string[];
}

/**
 * Scan all configured media directories for files to transcode
 * Combines discovery and analysis phases
 * @param analysisDb - Optional analysis database for caching ffprobe results
 */
export async function scanMediaDirectories(
  config: Config,
  db: TranscodeDatabase,
  analysisDb?: AnalysisDatabase,
): Promise<ScanResult> {
  // Phase 1: Discovery
  logger.info('Phase 1: Discovering video files...');
  const discovery = await discoverMediaFiles(config);

  // Filter by database state
  const { toAnalyze, alreadyDone, tooManyErrors } = filterByDatabaseState(discovery.files, db);

  logger.info(
    `Found ${discovery.files.length} video files (${discovery.excluded.length} excluded)`,
  );
  logger.info(`  Already transcoded: ${alreadyDone.length}`);
  logger.info(`  Too many errors: ${tooManyErrors.length}`);
  logger.info(`  To analyze: ${toAnalyze.length}`);

  // Phase 2: Analysis (uses cache if available)
  logger.info('Phase 2: Analyzing files...');
  const analysis = await analyzeFiles(
    toAnalyze,
    config,
    (current, total, path) => {
      logger.progress(current, total, `Analyzing: ${basename(path)}`);
    },
    analysisDb,
  );
  logger.progressEnd();

  // Combine results
  const result: ScanResult = {
    totalFiles: discovery.files.length + discovery.excluded.length,
    toTranscode: analysis.toTranscode,
    skipped: [
      ...alreadyDone.map((path) => ({ path, reason: 'Already transcoded' })),
      ...tooManyErrors.map((path) => ({ path, reason: 'Too many errors' })),
      ...analysis.skipped,
    ],
    excluded: discovery.excluded,
    errors: analysis.errors.map((e) => e.path),
  };

  logger.info(
    `Scan complete: ${result.totalFiles} files, ${result.toTranscode.length} to transcode, ${result.skipped.length} skipped`,
  );

  return result;
}

//═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
//═══════════════════════════════════════════════════════════════════════════════

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

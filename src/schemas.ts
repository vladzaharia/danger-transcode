/**
 * Zod schemas for configuration validation
 * Provides runtime type checking and validation for all configuration options
 */

import { z } from 'zod';

//═══════════════════════════════════════════════════════════════════════════════
// HARDWARE PROFILE SCHEMAS
//═══════════════════════════════════════════════════════════════════════════════

/** Supported hardware acceleration profiles */
export const HardwareProfileSchema = z.enum(['rockchip', 'nvidia', 'software', 'auto']);

/** Bitrate string format (e.g., "5M", "2500K") */
const BitrateStringSchema = z.string().regex(/^\d+(\.\d+)?[KMG]?$/i, {
  message: 'Bitrate must be a number optionally followed by K, M, or G (e.g., "5M", "2500K")',
});

/** Bitrate configuration for different resolutions */
export const BitrateConfigSchema = z.object({
  /** Bitrate for 720p and below (e.g., "2M") */
  low: BitrateStringSchema.default('2M'),
  /** Bitrate for 1080p (e.g., "5M") */
  medium: BitrateStringSchema.default('5M'),
  /** Bitrate for 4K and above (e.g., "15M") */
  high: BitrateStringSchema.default('15M'),
});

//═══════════════════════════════════════════════════════════════════════════════
// ENCODER-SPECIFIC SETTINGS
//═══════════════════════════════════════════════════════════════════════════════

/** NVIDIA NVENC encoder settings */
export const NvidiaEncoderSettingsSchema = z.object({
  /** NVENC preset (p1=fastest, p7=slowest/best quality) */
  preset: z.enum(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']).default('p5'),
  /** Encoding tune mode */
  tune: z.enum(['hq', 'll', 'ull', 'lossless']).default('hq'),
  /** Rate control mode */
  rcMode: z.enum(['constqp', 'vbr', 'cbr']).default('vbr'),
  /** Number of lookahead frames (0-32) */
  lookahead: z.number().int().min(0).max(32).default(20),
  /** Enable temporal adaptive quantization */
  temporalAq: z.boolean().default(true),
  /** Enable spatial adaptive quantization */
  spatialAq: z.boolean().default(false),
  /** AQ strength (1-15, only used if spatialAq is true) */
  aqStrength: z.number().int().min(1).max(15).default(8),
  /** Number of B-frames (0-4) */
  bFrames: z.number().int().min(0).max(4).default(3),
  /** B-frame reference mode */
  bRefMode: z.enum(['disabled', 'each', 'middle']).default('middle'),
  /** GOP size (keyframe interval) */
  gopSize: z.number().int().min(0).default(250),
});

/** Rockchip RKMPP encoder settings */
export const RockchipEncoderSettingsSchema = z.object({
  /** Rate control mode */
  rcMode: z.enum(['CQP', 'VBR', 'CBR', 'AVBR']).default('VBR'),
  /** Enable AFBC (ARM Frame Buffer Compression) */
  afbc: z.boolean().default(true),
  /** Quality level for CQP mode (0-51) */
  qp: z.number().int().min(0).max(51).default(23),
});

/** Software x265 encoder settings */
export const SoftwareEncoderSettingsSchema = z.object({
  /** Encoding preset */
  preset: z
    .enum([
      'ultrafast',
      'superfast',
      'veryfast',
      'faster',
      'fast',
      'medium',
      'slow',
      'slower',
      'veryslow',
    ])
    .default('medium'),
  /** CRF value (0-51, lower = better quality) */
  crf: z.number().int().min(0).max(51).default(23),
  /** Tune mode */
  tune: z.enum(['none', 'psnr', 'ssim', 'grain', 'fastdecode', 'zerolatency']).default('none'),
});

//═══════════════════════════════════════════════════════════════════════════════
// OUTPUT CONFIGURATION
//═══════════════════════════════════════════════════════════════════════════════

/** Output mode: transcode in place or to separate directory */
export const OutputModeSchema = z.enum(['in-place', 'separate']);

/** Output configuration */
export const OutputConfigSchema = z.object({
  /** Output mode */
  mode: OutputModeSchema.default('in-place'),
  /** Output directory (required if mode is 'separate') */
  directory: z.string().optional(),
  /** Preserve source directory structure in output */
  preserveStructure: z.boolean().default(true),
  /** Replace original files (only for 'in-place' mode) */
  replaceOriginal: z.boolean().default(true),
});

//═══════════════════════════════════════════════════════════════════════════════
// EXCLUSION RULES
//═══════════════════════════════════════════════════════════════════════════════

/** Exclusion rules for skipping files/directories */
export const ExclusionRulesSchema = z.object({
  /** Directory names to exclude (case-insensitive, matches any path component) */
  directories: z.array(z.string()).default([]),
  /** Patterns to match against full path (regex strings) */
  pathPatterns: z.array(z.string()).default([]),
  /** Patterns to match against filename only (regex strings) */
  filePatterns: z.array(z.string()).default([]),
  /** Literal strings that if found in path, exclude the file */
  pathContains: z.array(z.string()).default([]),
});

//═══════════════════════════════════════════════════════════════════════════════
// TRANSCODE LIST SCHEMAS
//═══════════════════════════════════════════════════════════════════════════════

/** Library type for media matching */
export const LibraryTypeSchema = z.enum(['tv', 'movie', 'both']);

/** Season/episode specification for granular selection */
export const EpisodeSpecSchema = z.object({
  /** Season number */
  season: z.number().int().positive(),
  /** Episode numbers within the season */
  episodes: z.array(z.number().int().positive()).optional(),
});

//═══════════════════════════════════════════════════════════════════════════════
// TRANSCODE LIST SCHEMAS (Profile-based)
//═══════════════════════════════════════════════════════════════════════════════

/**
 * Profile settings - configurable options that can be applied per-profile
 * Profiles group common settings for categories of media
 */
export const ProfileSettingsSchema = z.object({
  /** Which library this profile applies to */
  library: LibraryTypeSchema.optional(),
  /** Maximum height (resolution) for transcoding */
  maxHeight: z.number().int().min(240).max(4320).optional(),
  /** Target bitrate for encoding */
  bitrate: BitrateStringSchema.optional(),
  /** Transcode in place (replace original) */
  inPlace: z.boolean().optional(),
  /** Output directory for transcoded files */
  outputDir: z.string().optional(),
  /** Default priority for items in this profile (higher = process first) */
  priority: z.number().int().optional(),
});

/**
 * Media query - individual media item with query and optional overrides
 * Each item inherits settings from its profile but can override them
 */
export const MediaQuerySchema = z.object({
  /** Search query (supports exact match, wildcards *, fuzzy matching) */
  query: z.string().min(1),
  /** Filter: specific seasons to include (TV only) */
  seasons: z.array(z.number().int().positive()).optional(),
  /** Filter: specific episodes to include (TV only) */
  episodes: z.array(EpisodeSpecSchema).optional(),
  /** Override profile priority */
  priority: z.number().int().optional(),
  // All profile fields as optional overrides
  /** Override profile library setting */
  library: LibraryTypeSchema.optional(),
  /** Override profile maxHeight setting */
  maxHeight: z.number().int().min(240).max(4320).optional(),
  /** Override profile bitrate setting */
  bitrate: BitrateStringSchema.optional(),
  /** Override profile inPlace setting */
  inPlace: z.boolean().optional(),
  /** Override profile outputDir setting */
  outputDir: z.string().optional(),
});

/** Transcode list file schema (version 2 - profile-based) */
export const TranscodeListSchema = z.object({
  /** Version for compatibility (should be 2 for profile-based format) */
  version: z.number().int().default(2),
  /** Named profiles with common settings */
  profiles: z.record(z.string(), ProfileSettingsSchema),
  /** Media queries grouped by profile name */
  media: z.record(z.string(), z.array(MediaQuerySchema)),
});

/**
 * Resolved transcode item - internal type after flattening profiles
 * This is what downstream processing code works with
 */
export const ResolvedTranscodeItemSchema = z.object({
  /** Original search query */
  query: z.string().min(1),
  /** Resolved library type */
  library: LibraryTypeSchema.default('both'),
  /** Resolved transcode in place setting */
  inPlace: z.boolean().optional(),
  /** Resolved output directory */
  outputDir: z.string().optional(),
  /** Resolved maximum height */
  maxHeight: z.number().int().min(240).max(4320).optional(),
  /** Season filter */
  seasons: z.array(z.number().int().positive()).optional(),
  /** Episode filter */
  episodes: z.array(EpisodeSpecSchema).optional(),
  /** Resolved bitrate */
  bitrate: BitrateStringSchema.optional(),
  /** Resolved priority */
  priority: z.number().int().default(0),
  /** Profile name this item came from */
  profileName: z.string(),
});

//═══════════════════════════════════════════════════════════════════════════════
// MAIN CONFIGURATION SCHEMA
//═══════════════════════════════════════════════════════════════════════════════

/** Video file extensions */
const DEFAULT_VIDEO_EXTENSIONS = [
  '.mkv',
  '.mp4',
  '.avi',
  '.mov',
  '.m4v',
  '.wmv',
  '.flv',
  '.webm',
  '.ts',
  '.m2ts',
  '.mpg',
  '.mpeg',
  '.vob',
  '.divx',
  '.3gp',
];

/** Default exclusion rules */
const DEFAULT_EXCLUSIONS = {
  directories: [
    'karaoke',
    'singalong',
    'samples',
    'sample',
    'extras',
    'featurettes',
    'behind the scenes',
    'deleted scenes',
    'interviews',
    'trailers',
  ],
  pathPatterns: [],
  filePatterns: ['-sample\\.', '\\bsample\\b', '\\btrailer\\b'],
  pathContains: [],
};

/** Main configuration schema */
export const ConfigSchema = z.object({
  // ─── Core Paths ───────────────────────────────────────────────────────────
  /** Directories to scan for media files */
  mediaDirs: z.array(z.string()).min(1),
  /** Temporary directory for transcoding work */
  tempDir: z.string().default('/tmp/danger-transcode'),
  /** Path to the transcoding database file */
  databasePath: z.string().default('/var/lib/danger-transcode/database.json'),
  /** Path to the analysis cache file */
  analysisPath: z.string().default('/var/lib/danger-transcode/analysis.json'),
  /** Path to the error log file */
  errorLogPath: z.string().default('/var/lib/danger-transcode/errors.json'),
  /** Lock file path for singleton execution */
  lockFilePath: z.string().default('/tmp/danger-transcode.lock'),

  // ─── Processing Options ───────────────────────────────────────────────────
  /** Maximum concurrent transcodes */
  maxConcurrency: z.number().int().min(1).default(1),
  /** Maximum height for TV shows */
  tvMaxHeight: z.number().int().min(240).max(4320).default(720),
  /** Maximum height for movies */
  movieMaxHeight: z.number().int().min(240).max(4320).default(1080),
  /** Bitrate settings */
  bitrates: BitrateConfigSchema.default({ low: '2M', medium: '5M', high: '15M' }),

  // ─── File Filtering ───────────────────────────────────────────────────────
  /** Video file extensions to process */
  videoExtensions: z.array(z.string()).default(DEFAULT_VIDEO_EXTENSIONS),
  /** Exclusion rules for skipping files */
  exclusions: ExclusionRulesSchema.default(DEFAULT_EXCLUSIONS),

  // ─── FFmpeg Configuration ─────────────────────────────────────────────────
  /** Path to ffmpeg binary */
  ffmpegPath: z.string().default('ffmpeg'),
  /** Path to ffprobe binary */
  ffprobePath: z.string().default('ffprobe'),
  /** Enable hardware acceleration */
  useHardwareAccel: z.boolean().default(true),

  // ─── Hardware Profile ─────────────────────────────────────────────────────
  /** Hardware acceleration profile */
  hardwareProfile: HardwareProfileSchema.default('auto'),
  /** NVIDIA-specific encoder settings */
  nvidia: NvidiaEncoderSettingsSchema.optional(),
  /** Rockchip-specific encoder settings */
  rockchip: RockchipEncoderSettingsSchema.optional(),
  /** Software encoder settings */
  software: SoftwareEncoderSettingsSchema.optional(),

  // ─── Output Configuration ─────────────────────────────────────────────────
  /** Output configuration */
  output: OutputConfigSchema.optional(),

  // ─── Transcode List ───────────────────────────────────────────────────────
  /** Path to transcode list JSON file (enables selective transcoding) */
  transcodeListPath: z.string().optional(),

  // ─── Runtime Flags ────────────────────────────────────────────────────────
  /** Dry run mode - don't actually transcode */
  dryRun: z.boolean().default(false),
});

//═══════════════════════════════════════════════════════════════════════════════
// ANALYSIS DATABASE SCHEMAS
//═══════════════════════════════════════════════════════════════════════════════

/** Video stream info stored in analysis cache */
export const CachedVideoInfoSchema = z.object({
  codec_name: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  bit_rate: z.string().optional(),
});

/** Cached analysis result for a single file */
export const AnalysisRecordSchema = z.object({
  /** File path (key in the database) */
  path: z.string(),
  /** File size in bytes - used for cache invalidation */
  fileSize: z.number().int(),
  /** File modification time (ISO string) - used for cache invalidation */
  fileMtime: z.string(),
  /** When the analysis was performed */
  analyzedAt: z.string(),
  /** Video stream information (null if no video stream) */
  video: CachedVideoInfoSchema.nullable(),
  /** Whether the file has audio streams */
  hasAudio: z.boolean(),
  /** Whether the file has subtitle streams */
  hasSubtitles: z.boolean(),
  /** Duration in seconds */
  duration: z.number(),
  /** Format name from ffprobe */
  formatName: z.string(),
});

/** Analysis database structure */
export const AnalysisDatabaseSchema = z.object({
  version: z.number().int().default(1),
  lastUpdated: z.string(),
  records: z.record(z.string(), AnalysisRecordSchema),
});

//═══════════════════════════════════════════════════════════════════════════════
// TYPE EXPORTS
//═══════════════════════════════════════════════════════════════════════════════

export type HardwareProfile = z.infer<typeof HardwareProfileSchema>;
export type BitrateConfig = z.infer<typeof BitrateConfigSchema>;
export type NvidiaEncoderSettings = z.infer<typeof NvidiaEncoderSettingsSchema>;
export type RockchipEncoderSettings = z.infer<typeof RockchipEncoderSettingsSchema>;
export type SoftwareEncoderSettings = z.infer<typeof SoftwareEncoderSettingsSchema>;
export type OutputConfig = z.infer<typeof OutputConfigSchema>;
export type OutputMode = z.infer<typeof OutputModeSchema>;
export type ExclusionRules = z.infer<typeof ExclusionRulesSchema>;
export type ProfileSettings = z.infer<typeof ProfileSettingsSchema>;
export type MediaQuery = z.infer<typeof MediaQuerySchema>;
export type TranscodeList = z.infer<typeof TranscodeListSchema>;
export type ResolvedTranscodeItem = z.infer<typeof ResolvedTranscodeItemSchema>;
export type Config = z.infer<typeof ConfigSchema>;
export type LibraryType = z.infer<typeof LibraryTypeSchema>;
export type CachedVideoInfo = z.infer<typeof CachedVideoInfoSchema>;
export type AnalysisRecord = z.infer<typeof AnalysisRecordSchema>;
export type AnalysisDatabase = z.infer<typeof AnalysisDatabaseSchema>;


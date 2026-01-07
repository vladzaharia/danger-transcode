/**
 * Types and interfaces for the danger-transcode system
 */

/** Media type classification */
export type MediaType = 'tv' | 'movie' | 'other';

/** Transcoding status */
export type TranscodeStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

/** Video codec information from ffprobe */
export interface VideoStreamInfo {
  codec_name: string;
  codec_long_name?: string;
  width: number;
  height: number;
  pix_fmt?: string;
  bit_rate?: string;
  duration?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
}

/** Full ffprobe output structure */
export interface FFProbeOutput {
  streams: Array<{
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    pix_fmt?: string;
    bit_rate?: string;
    duration?: string;
    r_frame_rate?: string;
  }>;
  format: {
    filename: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
    format_name: string;
  };
}

/** Media file with analysis information */
export interface MediaFile {
  path: string;
  type: MediaType;
  codec: string;
  width: number;
  height: number;
  size: number;
  duration?: number;
  bitrate?: number;
  needsTranscode: boolean;
  skipReason?: string;
  targetWidth?: number;
  targetHeight?: number;
}

/** Record of a transcoded file stored in the database */
export interface TranscodeRecord {
  originalPath: string;
  transcodedAt: string;
  originalCodec: string;
  originalWidth: number;
  originalHeight: number;
  newWidth: number;
  newHeight: number;
  originalSize: number;
  newSize: number;
  duration: number;
  success: boolean;
  error?: string;
}

/** Error record for failed transcodes */
export interface ErrorRecord {
  path: string;
  timestamp: string;
  error: string;
  attempts: number;
}

/** Database structure */
export interface TranscodeDatabase {
  version: number;
  lastRun: string;
  records: Record<string, TranscodeRecord>;
  errors: Record<string, ErrorRecord>;
}

/** Bitrate configuration */
export interface BitrateConfig {
  /** Bitrate for 720p and below (e.g., "2M") */
  low: string;
  /** Bitrate for 1080p (e.g., "5M") */
  medium: string;
  /** Bitrate for 4K and above (e.g., "15M") */
  high: string;
}

/** Exclusion rules configuration (all fields optional) */
export interface ExclusionRules {
  /** Directory names to exclude (case-insensitive, matches any path component) */
  directories?: string[];
  /** Patterns to match against full path (regex strings) */
  pathPatterns?: string[];
  /** Patterns to match against filename only (regex strings) */
  filePatterns?: string[];
  /** Literal strings that if found in path, exclude the file */
  pathContains?: string[];
}

/** Main configuration */
export interface Config {
  /** Directories to scan for media files */
  mediaDirs: string[];
  /** Temporary directory for transcoding */
  tempDir: string;
  /** Path to the transcoding database file */
  databasePath: string;
  /** Path to the error log file */
  errorLogPath: string;
  /** Lock file path for singleton execution */
  lockFilePath: string;
  /** Maximum concurrent transcodes */
  maxConcurrency: number;
  /** Maximum height for TV shows (720p = 720) */
  tvMaxHeight: number;
  /** Maximum height for movies (1080p = 1080) */
  movieMaxHeight: number;
  /** Bitrate settings */
  bitrates: BitrateConfig;
  /** Video file extensions to process */
  videoExtensions: string[];
  /** Exclusion rules for skipping files (optional) */
  exclusions?: ExclusionRules;
  /** FFmpeg binary path (default: 'ffmpeg') */
  ffmpegPath: string;
  /** FFprobe binary path (default: 'ffprobe') */
  ffprobePath: string;
  /** Whether to use hardware acceleration */
  useHardwareAccel: boolean;
  /** Dry run mode - don't actually transcode */
  dryRun: boolean;
}

/** Transcoding job */
export interface TranscodeJob {
  file: MediaFile;
  status: TranscodeStatus;
  progress?: number;
  startTime?: Date;
  endTime?: Date;
  error?: string;
}

/** Statistics for the transcoding run */
export interface TranscodeStats {
  totalFiles: number;
  skipped: number;
  transcoded: number;
  failed: number;
  spaceSaved: number;
  totalDuration: number;
}

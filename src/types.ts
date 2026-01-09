/**
 * Types and interfaces for the danger-transcode system
 *
 * Note: Runtime-validated types are in schemas.ts using Zod.
 * This file contains additional interfaces not covered by Zod schemas.
 */

// Re-export Zod-inferred types for convenience
export type {
  HardwareProfile,
  BitrateConfig,
  NvidiaEncoderSettings,
  RockchipEncoderSettings,
  SoftwareEncoderSettings,
  OutputConfig,
  OutputMode,
  ExclusionRules,
  ProfileSettings,
  MediaQuery,
  TranscodeList,
  ResolvedTranscodeItem,
  Config,
  LibraryType,
} from './schemas.ts';

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
/** Per-file transcode overrides from transcode list profiles */
export interface TranscodeOverrides {
  maxHeight?: number;
  bitrate?: string;
  inPlace?: boolean;
  outputDir?: string;
  profileName?: string;
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
  /** Optional overrides from transcode list profile */
  overrides?: TranscodeOverrides;
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

//═══════════════════════════════════════════════════════════════════════════════
// ENCODER PROFILE TYPES
//═══════════════════════════════════════════════════════════════════════════════

/** FFmpeg arguments for hardware acceleration input */
export interface HWAccelInputArgs {
  hwaccel?: string;
  hwaccelOutputFormat?: string;
  extraInputArgs?: string[];
}

/** FFmpeg arguments for video encoding */
export interface EncoderArgs {
  encoder: string;
  bitrateArgs: string[];
  qualityArgs: string[];
  extraEncoderArgs?: string[];
}

/** FFmpeg arguments for scaling filter */
export interface ScalerArgs {
  filter: string;
  width: number;
  height: number;
}

/** Complete encoding profile for a specific hardware type */
export interface EncodingProfile {
  name: string;
  hwAccelInput: HWAccelInputArgs;
  encoder: EncoderArgs;
  getScaler: (width: number, height: number) => ScalerArgs | null;
}

//═══════════════════════════════════════════════════════════════════════════════
// MEDIA MATCHING TYPES
//═══════════════════════════════════════════════════════════════════════════════

/** Media entry for fuzzy matching index */
export interface MediaEntry {
  /** Clean name for searching */
  name: string;
  /** Original folder/file name */
  originalName: string;
  /** Full path to the media */
  path: string;
  /** Library type */
  library: 'tv' | 'movie';
  /** Year extracted from name (if present) */
  year?: number;
  /** Available seasons (TV only) */
  seasons?: number[];
}

/** Result of a media match */
export interface MatchResult {
  entry: MediaEntry;
  score: number;
  matchedQuery: string;
}

/** Processed transcode item with matched files */
export interface ProcessedTranscodeItem {
  originalQuery: string;
  profileName: string;
  matches: MatchResult[];
  overrides: {
    inPlace?: boolean;
    outputDir?: string;
    maxHeight?: number;
    bitrate?: string;
  };
}

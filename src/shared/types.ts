/**
 * Shared types for danger-transcode
 * Unified configuration and common interfaces used by both modules
 */

import type { VIDEO_EXTENSIONS } from './constants.ts';

//═══════════════════════════════════════════════════════════════════════════════
// SHARED CONFIGURATION TYPES
//═══════════════════════════════════════════════════════════════════════════════

/** Bitrate configuration */
export interface BitrateConfig {
  /** Bitrate for 720p and below (e.g., "2M") */
  low: string;
  /** Bitrate for 1080p (e.g., "5M") */
  medium: string;
  /** Bitrate for 4K and above (e.g., "15M") */
  high: string;
}

/** Exclusion rules configuration */
export interface ExclusionRules {
  /** Directory names to exclude (case-insensitive) */
  directories?: string[];
  /** Patterns to match against full path (regex strings) */
  pathPatterns?: string[];
  /** Patterns to match against filename only (regex strings) */
  filePatterns?: string[];
  /** Literal strings that if found in path, exclude the file */
  pathContains?: string[];
}

/** Shared configuration between modules */
export interface SharedConfig {
  /** Media directories to scan/sync from */
  mediaDirs: string[];
  /** Temporary directory for processing */
  tempDir: string;
  /** Maximum concurrent operations */
  maxConcurrency: number;
  /** Dry run mode - don't make changes */
  dryRun: boolean;
  /** Video file extensions to process */
  videoExtensions: string[];
  /** FFmpeg binary path */
  ffmpegPath: string;
  /** FFprobe binary path */
  ffprobePath: string;
}

//═══════════════════════════════════════════════════════════════════════════════
// TRANSCODE MODULE CONFIGURATION
//═══════════════════════════════════════════════════════════════════════════════

/** Transcode-specific configuration */
export interface TranscodeModuleConfig {
  /** Path to the transcoding database file */
  databasePath: string;
  /** Path to the error log file */
  errorLogPath: string;
  /** Lock file path for singleton execution */
  lockFilePath: string;
  /** Maximum height for TV shows (720p = 720) */
  tvMaxHeight: number;
  /** Maximum height for movies (1080p = 1080) */
  movieMaxHeight: number;
  /** Bitrate settings */
  bitrates: BitrateConfig;
  /** Exclusion rules for skipping files */
  exclusions?: ExclusionRules;
  /** Whether to use hardware acceleration */
  useHardwareAccel: boolean;
}

//═══════════════════════════════════════════════════════════════════════════════
// SYNC MODULE CONFIGURATION
//═══════════════════════════════════════════════════════════════════════════════

/** Destination drive configuration */
export interface DestinationDrive {
  /** Path to the destination directory */
  path: string;
  /** Label for display purposes */
  label: string;
  /** Bytes to keep reserved */
  reservedBytes: number;
  /** Priority for allocation (lower = preferred) */
  priority: number;
}

/** Selection criteria for popular movies */
export interface PopularMoviesCriteria {
  enabled: boolean;
  limit: number;
}

/** Selection criteria for trending movies */
export interface TrendingMoviesCriteria {
  enabled: boolean;
  timeWindow: 'day' | 'week';
  limit: number;
}

/** Selection criteria for top-rated movies */
export interface TopRatedMoviesCriteria {
  enabled: boolean;
  limit: number;
}

/** Selection criteria for Oscar winners */
export interface OscarWinnersCriteria {
  enabled: boolean;
  years: number;
}

/** Franchise configuration */
export interface FranchiseConfig {
  name: string;
  patterns: string[];
  tmdbCollections?: number[];
  tmdbLists?: number[];
}

/** Genre distribution settings */
export interface GenreDistribution {
  enabled: boolean;
  minPerGenre: number;
}

/** Media selection configuration */
export interface SelectionConfig {
  latestTvSeasons: boolean;
  popularMovies: PopularMoviesCriteria;
  trendingMovies: TrendingMoviesCriteria;
  topRatedMovies: TopRatedMoviesCriteria;
  oscarWinners: OscarWinnersCriteria;
  franchises: FranchiseConfig[];
  tmdbLists: number[];
  tmdbCollections: number[];
}

/** Sync-specific configuration */
export interface SyncModuleConfig {
  /** Destination drives */
  destinations: DestinationDrive[];
  /** TMDB API key (v3) */
  tmdbApiKey: string;
  /** TMDB API read access token (v4, optional) */
  tmdbReadAccessToken?: string;
  /** Selection criteria */
  selection: SelectionConfig;
  /** Genre distribution settings */
  genreDistribution: GenreDistribution;
  /** Path to sync database */
  syncDatabasePath: string;
  /** OpenSubtitles API key (optional) */
  openSubtitlesApiKey?: string;
  /** Whether to download missing metadata */
  downloadMissingMetadata: boolean;
}

//═══════════════════════════════════════════════════════════════════════════════
// UNIFIED CONFIGURATION
//═══════════════════════════════════════════════════════════════════════════════

/**
 * Unified configuration for danger-transcode
 * Contains shared settings and module-specific sections
 */
export interface UnifiedConfig {
  /** Shared configuration between modules */
  shared: SharedConfig;
  /** Transcode module configuration */
  transcode: TranscodeModuleConfig;
  /** Sync module configuration */
  sync: SyncModuleConfig;
}

//═══════════════════════════════════════════════════════════════════════════════
// LEGACY CONFIG TYPE ALIASES (for backward compatibility)
//═══════════════════════════════════════════════════════════════════════════════

/**
 * Legacy Config type for transcode module
 * Flattened version combining shared + transcode settings
 */
export interface LegacyTranscodeConfig {
  mediaDirs: string[];
  tempDir: string;
  databasePath: string;
  errorLogPath: string;
  lockFilePath: string;
  maxConcurrency: number;
  tvMaxHeight: number;
  movieMaxHeight: number;
  bitrates: BitrateConfig;
  videoExtensions: string[];
  exclusions?: ExclusionRules;
  ffmpegPath: string;
  ffprobePath: string;
  useHardwareAccel: boolean;
  dryRun: boolean;
}

/**
 * Legacy SyncConfig type for sync module
 * Flattened version combining shared + sync settings
 */
export interface LegacySyncConfig {
  sourceMediaDirs: string[];
  destinations: DestinationDrive[];
  tmdbApiKey: string;
  tmdbReadAccessToken?: string;
  selection: SelectionConfig;
  genreDistribution: GenreDistribution;
  tempDir: string;
  syncDatabasePath: string;
  openSubtitlesApiKey?: string;
  downloadMissingMetadata: boolean;
  maxConcurrency: number;
  dryRun: boolean;
}

//═══════════════════════════════════════════════════════════════════════════════
// COMMON MEDIA TYPES
//═══════════════════════════════════════════════════════════════════════════════

/** Media type classification */
export type MediaType = 'tv' | 'movie' | 'other';

/** Video extension type */
export type VideoExtension = (typeof VIDEO_EXTENSIONS)[number];

/** Resolution preset names */
export type ResolutionPreset = '4k' | '1440p' | '1080p' | '720p' | '480p' | '360p';

/** Resolution dimensions */
export interface Resolution {
  width: number;
  height: number;
}

/** Basic media info shared between modules */
export interface BasicMediaInfo {
  path: string;
  title: string;
  year?: number;
  type: MediaType;
  size: number;
  duration?: number;
}


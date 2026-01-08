/**
 * Types for the portable media sync system
 */

import type { BitrateConfig, Config } from '../transcode/types.ts';

//═══════════════════════════════════════════════════════════════════════════════
// SYNC CONFIGURATION
//═══════════════════════════════════════════════════════════════════════════════

/** Destination drive configuration */
export interface DestinationDrive {
  /** Path to the destination directory */
  path: string;
  /** Label for display purposes */
  label: string;
  /** Bytes to keep reserved (e.g., 32GB = 32 * 1024 * 1024 * 1024) */
  reservedBytes: number;
  /** Priority for allocation (lower = preferred) */
  priority: number;
}

/** Selection criteria for popular movies */
export interface PopularMoviesCriteria {
  enabled: boolean;
  /** Maximum number to select */
  limit: number;
}

/** Selection criteria for trending movies */
export interface TrendingMoviesCriteria {
  enabled: boolean;
  /** Time window: 'day' or 'week' */
  timeWindow: 'day' | 'week';
  /** Maximum number to select */
  limit: number;
}

/** Selection criteria for top-rated movies */
export interface TopRatedMoviesCriteria {
  enabled: boolean;
  /** Maximum number to select */
  limit: number;
}

/** Selection criteria for Oscar winners */
export interface OscarWinnersCriteria {
  enabled: boolean;
  /** Number of years to look back */
  years: number;
}

/** Franchise configuration for pattern matching */
export interface FranchiseConfig {
  /** Display name of the franchise */
  name: string;
  /** Regex patterns to match against titles (case-insensitive) */
  patterns: string[];
  /** TMDB collection IDs to include */
  tmdbCollections?: number[];
  /** TMDB list IDs to include */
  tmdbLists?: number[];
}

/** Genre distribution settings */
export interface GenreDistribution {
  enabled: boolean;
  /** Minimum number of items per genre */
  minPerGenre: number;
}

/** Media selection configuration */
export interface SelectionConfig {
  /** Select the latest season of each TV show */
  latestTvSeasons: boolean;
  /** Popular movies criteria */
  popularMovies: PopularMoviesCriteria;
  /** Trending movies criteria */
  trendingMovies: TrendingMoviesCriteria;
  /** Top-rated movies criteria */
  topRatedMovies: TopRatedMoviesCriteria;
  /** Oscar winners criteria */
  oscarWinners: OscarWinnersCriteria;
  /** Franchise configurations */
  franchises: FranchiseConfig[];
  /** Additional TMDB list IDs to sync */
  tmdbLists: number[];
  /** Additional TMDB collection IDs to sync */
  tmdbCollections: number[];
}

/** Complete sync configuration */
export interface SyncConfig {
  /** Source media directories to sync from */
  sourceMediaDirs: string[];
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
  /** Temporary directory for processing */
  tempDir: string;
  /** Path to sync database */
  syncDatabasePath: string;
  /** OpenSubtitles API key (optional) */
  openSubtitlesApiKey?: string;
  /** Whether to download missing metadata */
  downloadMissingMetadata: boolean;
  /** Maximum concurrent operations */
  maxConcurrency: number;
  /** Dry run mode */
  dryRun: boolean;
}

//═══════════════════════════════════════════════════════════════════════════════
// MEDIA TYPES
//═══════════════════════════════════════════════════════════════════════════════

/** Type of media item */
export type SyncMediaType = 'movie' | 'tv_show' | 'tv_season';

/** Episode information */
export interface EpisodeInfo {
  episodeNumber: number;
  title?: string;
  path: string;
  size: number;
  duration?: number;
  tmdbId?: number;
}

/** Season information */
export interface SeasonInfo {
  seasonNumber: number;
  episodes: EpisodeInfo[];
  path: string;
  totalSize: number;
  tmdbId?: number;
}

/** TV show information */
export interface TVShowInfo {
  title: string;
  year?: number;
  path: string;
  seasons: SeasonInfo[];
  tmdbId?: number;
  imdbId?: string;
  genres?: string[];
}

/** Movie information */
export interface MovieInfo {
  title: string;
  year?: number;
  path: string;
  size: number;
  duration?: number;
  tmdbId?: number;
  imdbId?: string;
  genres?: string[];
  popularity?: number;
  rating?: number;
}

/** Source of selection (for tracking why an item was selected) */
export type SelectionSource =
  | 'latest_season'
  | 'popular_movies'
  | 'trending_movies'
  | 'top_rated_movies'
  | 'oscar_winner'
  | 'franchise'
  | 'tmdb_list'
  | 'tmdb_collection'
  | 'genre_distribution';

/** A media item selected for syncing */
export interface SyncItem {
  id: string;
  type: SyncMediaType;
  title: string;
  year?: number;
  sourcePath: string;
  estimatedSize: number;
  priority: number;
  selectionSources: SelectionSource[];
  genres: string[];
  tmdbId?: number;
  imdbId?: string;
  /** For TV shows/seasons */
  seasonNumber?: number;
  episodes?: EpisodeInfo[];
  /** Media details for transcoding */
  duration: number;
  resolution?: { width: number; height: number };
  originalCodec?: string;
}

//═══════════════════════════════════════════════════════════════════════════════
// ALLOCATION TYPES
//═══════════════════════════════════════════════════════════════════════════════

/** Allocation of items to a drive */
export interface DriveAllocation {
  drive: DestinationDrive;
  totalCapacity: number;
  usedSpace: number;
  availableSpace: number;
  allocatedItems: SyncItem[];
  allocatedSize: number;
}

/** Complete allocation plan */
export interface AllocationPlan {
  allocations: DriveAllocation[];
  unallocatedItems: SyncItem[];
  totalItemsAllocated: number;
  totalSizeAllocated: number;
  warnings: string[];
}

//═══════════════════════════════════════════════════════════════════════════════
// METADATA TYPES
//═══════════════════════════════════════════════════════════════════════════════

/** Metadata file types */
export type MetadataFileType = 'nfo' | 'poster' | 'fanart' | 'banner' | 'logo' | 'thumb' | 'subtitle';

/** Metadata status for an item */
export interface MetadataStatus {
  nfo: boolean;
  poster: boolean;
  fanart: boolean;
  banner: boolean;
  logo: boolean;
  thumb: boolean;
  subtitles: string[];
  missingTypes: MetadataFileType[];
}

/** NFO metadata structure (Kodi/Jellyfin compatible) */
export interface MovieNFO {
  title: string;
  originalTitle?: string;
  year: number;
  plot?: string;
  outline?: string;
  runtime?: number;
  genres: string[];
  directors: string[];
  writers: string[];
  studios: string[];
  cast: { name: string; role?: string; thumb?: string }[];
  ratings: { source: string; value: number; votes?: number }[];
  uniqueIds: { type: string; value: string; default?: boolean }[];
  premiered?: string;
  mpaa?: string;
  tagline?: string;
}

/** TV show NFO metadata */
export interface TVShowNFO {
  title: string;
  originalTitle?: string;
  year: number;
  plot?: string;
  genres: string[];
  studios: string[];
  cast: { name: string; role?: string; thumb?: string }[];
  ratings: { source: string; value: number; votes?: number }[];
  uniqueIds: { type: string; value: string; default?: boolean }[];
  premiered?: string;
  mpaa?: string;
  status?: string;
}

/** Episode NFO metadata */
export interface EpisodeNFO {
  title: string;
  season: number;
  episode: number;
  plot?: string;
  aired?: string;
  runtime?: number;
  directors: string[];
  writers: string[];
  ratings: { source: string; value: number; votes?: number }[];
  uniqueIds: { type: string; value: string; default?: boolean }[];
  thumb?: string;
}

//═══════════════════════════════════════════════════════════════════════════════
// SYNC STATE TYPES
//═══════════════════════════════════════════════════════════════════════════════

/** State of a synced item in the database */
export interface SyncedItemRecord {
  id: string;
  sourcePath: string;
  destPath: string;
  destDrive: string;
  syncedAt: string;
  transcodedSize: number;
  originalSize: number;
  type: SyncMediaType;
  title: string;
  tmdbId?: number;
  metadata: {
    nfo: boolean;
    poster: boolean;
    fanart: boolean;
    subtitles: string[];
  };
  checksum?: string;
}

/** Sync database structure */
export interface SyncDatabase {
  version: number;
  lastSync: string;
  syncedItems: Record<string, SyncedItemRecord>;
  tmdbCache: {
    popular: { data: unknown; fetchedAt: string };
    trending: { data: unknown; fetchedAt: string };
    topRated: { data: unknown; fetchedAt: string };
    collections: Record<string, { data: unknown; fetchedAt: string }>;
  };
}

//═══════════════════════════════════════════════════════════════════════════════
// PIPELINE TYPES
//═══════════════════════════════════════════════════════════════════════════════

/** Status of a sync operation */
export type SyncStatus = 'pending' | 'copying' | 'transcoding' | 'metadata' | 'moving' | 'complete' | 'failed';

/** Progress callback for sync operations */
export interface SyncProgress {
  itemId: string;
  title: string;
  status: SyncStatus;
  progress: number; // 0-100
  currentStep: string;
  bytesProcessed?: number;
  totalBytes?: number;
  eta?: number;
  error?: string;
}

/** Callback function type for progress updates */
export type SyncProgressCallback = (progress: SyncProgress) => void;

/** Result of a sync operation */
export interface SyncResult {
  itemId: string;
  success: boolean;
  destPath?: string;
  transcodedSize?: number;
  error?: string;
  duration: number;
}

/** Summary of a complete sync run */
export interface SyncSummary {
  startTime: string;
  endTime: string;
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  totalBytesTransferred: number;
  totalBytesSaved: number;
  results: SyncResult[];
  warnings: string[];
}


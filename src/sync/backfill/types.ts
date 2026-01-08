/**
 * Backfill Types
 * Types for the backfill module that handles episode gaps and movie collection completion
 */

import type { EpisodeInfo, MovieInfo, TVShowInfo } from '../types.ts';

/** Result of scanning destination for existing content */
export interface DestinationContent {
  /** TV shows found on destination with their episodes */
  tvShows: DestinationTVShow[];
  /** Movies found on destination */
  movies: DestinationMovie[];
}

/** TV show found on destination drive */
export interface DestinationTVShow {
  title: string;
  path: string;
  tmdbId?: number;
  seasons: DestinationSeason[];
}

/** Season found on destination */
export interface DestinationSeason {
  seasonNumber: number;
  path: string;
  episodes: number[]; // Episode numbers present
}

/** Movie found on destination drive */
export interface DestinationMovie {
  title: string;
  year?: number;
  path: string;
  tmdbId?: number;
  /** TMDB collection ID if this movie belongs to a collection */
  collectionId?: number;
  collectionName?: string;
}

/** Missing episode that needs to be backfilled */
export interface MissingEpisode {
  showTitle: string;
  showTmdbId?: number;
  seasonNumber: number;
  episodeNumber: number;
  /** Source path where this episode can be found */
  sourcePath?: string;
  /** Estimated size in bytes */
  estimatedSize: number;
  /** Episode metadata from TMDB */
  episodeTitle?: string;
}

/** Missing movie from a collection that needs to be backfilled */
export interface MissingMovie {
  title: string;
  year: number;
  tmdbId: number;
  /** The collection this movie belongs to */
  collectionId: number;
  collectionName: string;
  /** Source path where this movie can be found */
  sourcePath?: string;
  /** Estimated size in bytes */
  estimatedSize: number;
}

/** Result of backfill gap analysis */
export interface BackfillAnalysis {
  /** Missing episodes across all TV shows on destination */
  missingEpisodes: MissingEpisode[];
  /** Missing movies from collections */
  missingMovies: MissingMovie[];
  /** Total estimated size of all missing content */
  totalEstimatedSize: number;
  /** Summary statistics */
  stats: BackfillStats;
}

/** Statistics about the backfill analysis */
export interface BackfillStats {
  /** Number of TV shows analyzed */
  tvShowsAnalyzed: number;
  /** Number of seasons with gaps */
  seasonsWithGaps: number;
  /** Total missing episodes */
  totalMissingEpisodes: number;
  /** Number of incomplete collections found */
  incompleteCollections: number;
  /** Total missing movies from collections */
  totalMissingMovies: number;
  /** Number of items that have a source available */
  itemsWithSource: number;
  /** Number of items with no source available */
  itemsWithoutSource: number;
}

/** Options for backfill operation */
export interface BackfillOptions {
  /** TMDB API key */
  tmdbApiKey: string;
  /** Source media directories to find missing content */
  sourceMediaDirs: string[];
  /** Destination directories to analyze for gaps */
  destinationDirs: string[];
  /** Whether to also fill missing metadata */
  fillMetadata: boolean;
  /** Whether to actually copy files or just report */
  dryRun: boolean;
  /** Maximum concurrent operations */
  concurrency: number;
  /** Transcoder configuration for transcoding during backfill */
  transcoderConfig?: unknown;
}

/** Progress callback for backfill operations */
export type BackfillProgressCallback = (
  phase: string,
  current: number,
  total: number,
  item: string
) => void;

/** Result of a backfill operation */
export interface BackfillResult {
  /** Number of episodes backfilled */
  episodesBackfilled: number;
  /** Number of movies backfilled */
  moviesBackfilled: number;
  /** Number of metadata items filled */
  metadataFilled: number;
  /** Items that failed */
  failures: { path: string; error: string }[];
  /** Total bytes copied */
  totalBytesCopied: number;
}


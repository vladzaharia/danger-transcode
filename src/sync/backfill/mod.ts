/**
 * Backfill Module
 * Handles backfilling missing episodes, collection movies, and metadata
 */

export type {
  BackfillOptions,
  BackfillAnalysis,
  BackfillResult,
  BackfillStats,
  BackfillProgressCallback,
  MissingEpisode,
  MissingMovie,
  DestinationContent,
  DestinationTVShow,
  DestinationSeason,
  DestinationMovie,
} from './types.ts';

export { scanDestination, scanTVShowDirectory, scanMovieDirectory } from './scanner.ts';
export { findAllMissingEpisodes, findMissingEpisodesForShow, matchShowsWithSource } from './episodes.ts';
export { findMissingCollectionMovies } from './collections.ts';
export {
  analyzeBackfill,
  printBackfillAnalysis,
  executeBackfill,
  printBackfillResult,
} from './backfill.ts';


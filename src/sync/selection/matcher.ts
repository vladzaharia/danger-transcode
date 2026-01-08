/**
 * Media Selection Matcher
 * Matches local library against selection criteria
 */

import type {
  SyncConfig,
  MovieInfo,
  TVShowInfo,
  SyncItem,
  SelectionSource,
} from '../types.ts';
import type { TMDBMovieListItem } from '../tmdb/types.ts';
import { OSCAR_BEST_PICTURE_WINNERS } from '../tmdb/types.ts';
import { TMDBClient } from '../tmdb/client.ts';
import {
  DEFAULT_FRANCHISES,
  compileFranchises,
  matchAllFranchises,
  getAllFranchiseCollectionIds,
} from './franchises.ts';

/** Normalize title for comparison */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();
}

/** Calculate similarity between two titles (0-1) */
function titleSimilarity(a: string, b: string): number {
  const normA = normalizeTitle(a);
  const normB = normalizeTitle(b);

  if (normA === normB) return 1;

  // Check if one contains the other
  if (normA.includes(normB) || normB.includes(normA)) {
    return 0.9;
  }

  // Simple word overlap
  const wordsA = new Set(normA.split(' '));
  const wordsB = new Set(normB.split(' '));
  const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

/** Match a TMDB movie to local library */
function findLocalMovie(
  tmdbMovie: TMDBMovieListItem,
  localMovies: MovieInfo[],
  threshold = 0.7
): MovieInfo | null {
  const tmdbYear = tmdbMovie.release_date
    ? parseInt(tmdbMovie.release_date.substring(0, 4), 10)
    : null;

  let bestMatch: MovieInfo | null = null;
  let bestScore = threshold;

  for (const local of localMovies) {
    // Check title similarity
    let score = titleSimilarity(tmdbMovie.title, local.title);

    // Also check original title
    if (tmdbMovie.original_title !== tmdbMovie.title) {
      const origScore = titleSimilarity(tmdbMovie.original_title, local.title);
      score = Math.max(score, origScore);
    }

    // Boost score if years match
    if (tmdbYear && local.year) {
      if (tmdbYear === local.year) {
        score += 0.2;
      } else if (Math.abs(tmdbYear - local.year) === 1) {
        score += 0.1; // Allow 1 year difference
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = local;
    }
  }

  return bestMatch;
}

/** Selection result with metadata */
export interface SelectionResult {
  items: SyncItem[];
  stats: {
    totalSelected: number;
    bySource: Record<SelectionSource, number>;
    byGenre: Record<string, number>;
    tvShows: number;
    movies: number;
  };
}

/** Select media based on configuration */
export async function selectMedia(
  config: SyncConfig,
  localMovies: MovieInfo[],
  localTVShows: TVShowInfo[],
  tmdbClient: TMDBClient,
  progressCallback?: (phase: string, current: number, total: number) => void
): Promise<SelectionResult> {
  const selectedItems: Map<string, SyncItem> = new Map();
  const stats = {
    totalSelected: 0,
    bySource: {} as Record<SelectionSource, number>,
    byGenre: {} as Record<string, number>,
    tvShows: 0,
    movies: 0,
  };

  // Initialize source counts
  const sources: SelectionSource[] = [
    'latest_season', 'popular_movies', 'trending_movies', 'top_rated_movies',
    'oscar_winner', 'franchise', 'tmdb_list', 'tmdb_collection', 'genre_distribution',
  ];
  for (const source of sources) {
    stats.bySource[source] = 0;
  }

  // Helper to add a movie to selection
  const addMovie = (movie: MovieInfo, source: SelectionSource, priority: number) => {
    const id = `movie:${movie.path}`;
    const existing = selectedItems.get(id);

    if (existing) {
      // Add source if not already present
      if (!existing.selectionSources.includes(source)) {
        existing.selectionSources.push(source);
      }
      // Update priority if higher
      existing.priority = Math.max(existing.priority, priority);
    } else {
      selectedItems.set(id, {
        id,
        type: 'movie',
        title: movie.title,
        year: movie.year,
        sourcePath: movie.path,
        estimatedSize: movie.size, // Will be updated by estimator
        priority,
        selectionSources: [source],
        genres: movie.genres || [],
        tmdbId: movie.tmdbId,
        imdbId: movie.imdbId,
        duration: movie.duration || 0,
      });
      stats.movies++;
    }
    stats.bySource[source]++;
  };

  // Helper to add a TV season to selection
  const addTVSeason = (show: TVShowInfo, seasonIndex: number, source: SelectionSource, priority: number) => {
    const season = show.seasons[seasonIndex];
    const id = `tv:${show.path}:s${season.seasonNumber}`;
    const existing = selectedItems.get(id);

    if (existing) {
      if (!existing.selectionSources.includes(source)) {
        existing.selectionSources.push(source);
      }
      existing.priority = Math.max(existing.priority, priority);
    } else {
      const totalDuration = season.episodes.reduce((sum, ep) => sum + (ep.duration || 0), 0);

      selectedItems.set(id, {
        id,
        type: 'tv_season',
        title: show.title,
        year: show.year,
        sourcePath: season.path,
        estimatedSize: season.totalSize,
        priority,
        selectionSources: [source],
        genres: show.genres || [],
        tmdbId: show.tmdbId,
        imdbId: show.imdbId,
        seasonNumber: season.seasonNumber,
        episodes: season.episodes,
        duration: totalDuration,
      });
      stats.tvShows++;
    }
    stats.bySource[source]++;
  };

  //═══════════════════════════════════════════════════════════════════════════
  // SELECTION PHASE 1: Latest TV Seasons
  //═══════════════════════════════════════════════════════════════════════════

  if (config.selection.latestTvSeasons) {
    progressCallback?.('Selecting latest TV seasons', 0, localTVShows.length);

    for (let i = 0; i < localTVShows.length; i++) {
      const show = localTVShows[i];
      progressCallback?.('Selecting latest TV seasons', i + 1, localTVShows.length);

      if (show.seasons.length > 0) {
        // Find the latest season (highest season number)
        const latestSeasonIndex = show.seasons.reduce(
          (maxIdx, season, idx, arr) =>
            season.seasonNumber > arr[maxIdx].seasonNumber ? idx : maxIdx,
          0
        );
        addTVSeason(show, latestSeasonIndex, 'latest_season', 50);
      }
    }
  }

  //═══════════════════════════════════════════════════════════════════════════
  // SELECTION PHASE 2: Popular Movies
  //═══════════════════════════════════════════════════════════════════════════

  if (config.selection.popularMovies.enabled) {
    progressCallback?.('Fetching popular movies from TMDB', 0, 1);
    const popularMovies = await tmdbClient.getPopularMovies(config.selection.popularMovies.limit);
    progressCallback?.('Matching popular movies', 0, popularMovies.length);

    for (let i = 0; i < popularMovies.length; i++) {
      const tmdbMovie = popularMovies[i];
      progressCallback?.('Matching popular movies', i + 1, popularMovies.length);

      const localMatch = findLocalMovie(tmdbMovie, localMovies);
      if (localMatch) {
        // Priority based on position in popular list
        const priority = 100 - Math.floor((i / popularMovies.length) * 50);
        addMovie(localMatch, 'popular_movies', priority);
      }
    }
  }

  //═══════════════════════════════════════════════════════════════════════════
  // SELECTION PHASE 3: Trending Movies
  //═══════════════════════════════════════════════════════════════════════════

  if (config.selection.trendingMovies.enabled) {
    progressCallback?.('Fetching trending movies from TMDB', 0, 1);
    const trendingMovies = await tmdbClient.getTrendingMovies(
      config.selection.trendingMovies.timeWindow,
      config.selection.trendingMovies.limit
    );
    progressCallback?.('Matching trending movies', 0, trendingMovies.length);

    for (let i = 0; i < trendingMovies.length; i++) {
      const tmdbMovie = trendingMovies[i];
      progressCallback?.('Matching trending movies', i + 1, trendingMovies.length);

      const localMatch = findLocalMovie(tmdbMovie, localMovies);
      if (localMatch) {
        const priority = 90 - Math.floor((i / trendingMovies.length) * 40);
        addMovie(localMatch, 'trending_movies', priority);
      }
    }
  }

  //═══════════════════════════════════════════════════════════════════════════
  // SELECTION PHASE 4: Top-Rated Movies
  //═══════════════════════════════════════════════════════════════════════════

  if (config.selection.topRatedMovies.enabled) {
    progressCallback?.('Fetching top-rated movies from TMDB', 0, 1);
    const topRatedMovies = await tmdbClient.getTopRatedMovies(config.selection.topRatedMovies.limit);
    progressCallback?.('Matching top-rated movies', 0, topRatedMovies.length);

    for (let i = 0; i < topRatedMovies.length; i++) {
      const tmdbMovie = topRatedMovies[i];
      progressCallback?.('Matching top-rated movies', i + 1, topRatedMovies.length);

      const localMatch = findLocalMovie(tmdbMovie, localMovies);
      if (localMatch) {
        const priority = 85 - Math.floor((i / topRatedMovies.length) * 35);
        addMovie(localMatch, 'top_rated_movies', priority);
      }
    }
  }

  //═══════════════════════════════════════════════════════════════════════════
  // SELECTION PHASE 5: Oscar Winners
  //═══════════════════════════════════════════════════════════════════════════

  if (config.selection.oscarWinners.enabled) {
    const currentYear = new Date().getFullYear();
    const cutoffYear = currentYear - config.selection.oscarWinners.years;

    const recentWinners = OSCAR_BEST_PICTURE_WINNERS.filter((w) => w.year >= cutoffYear);
    progressCallback?.('Matching Oscar winners', 0, recentWinners.length);

    for (let i = 0; i < recentWinners.length; i++) {
      const winner = recentWinners[i];
      progressCallback?.('Matching Oscar winners', i + 1, recentWinners.length);

      // Find in local library
      const localMatch = localMovies.find(
        (m) =>
          titleSimilarity(m.title, winner.title) > 0.8 &&
          (!m.year || Math.abs(m.year - winner.year) <= 1)
      );

      if (localMatch) {
        addMovie(localMatch, 'oscar_winner', 95);
      }
    }
  }

  //═══════════════════════════════════════════════════════════════════════════
  // SELECTION PHASE 6: Franchises
  //═══════════════════════════════════════════════════════════════════════════

  const franchises = [...DEFAULT_FRANCHISES, ...config.selection.franchises];
  const compiledFranchises = compileFranchises(franchises);

  // Match local movies against franchise patterns
  progressCallback?.('Matching franchise movies', 0, localMovies.length);
  for (let i = 0; i < localMovies.length; i++) {
    const movie = localMovies[i];
    progressCallback?.('Matching franchise movies', i + 1, localMovies.length);

    const matchedFranchises = matchAllFranchises(movie.title, compiledFranchises);
    if (matchedFranchises.length > 0) {
      addMovie(movie, 'franchise', 70);
    }
  }

  // Match local TV shows against franchise patterns
  progressCallback?.('Matching franchise TV shows', 0, localTVShows.length);
  for (let i = 0; i < localTVShows.length; i++) {
    const show = localTVShows[i];
    progressCallback?.('Matching franchise TV shows', i + 1, localTVShows.length);

    const matchedFranchises = matchAllFranchises(show.title, compiledFranchises);
    if (matchedFranchises.length > 0) {
      // Add all seasons for franchise shows
      for (let j = 0; j < show.seasons.length; j++) {
        addTVSeason(show, j, 'franchise', 70);
      }
    }
  }

  // Fetch TMDB collections for franchises
  const collectionIds = [
    ...getAllFranchiseCollectionIds(franchises),
    ...config.selection.tmdbCollections,
  ];

  if (collectionIds.length > 0) {
    progressCallback?.('Fetching franchise collections from TMDB', 0, collectionIds.length);
    const collectionMovies = await tmdbClient.getCollectionMovies(collectionIds);

    progressCallback?.('Matching collection movies', 0, collectionMovies.length);
    for (let i = 0; i < collectionMovies.length; i++) {
      const tmdbMovie = collectionMovies[i];
      progressCallback?.('Matching collection movies', i + 1, collectionMovies.length);

      const localMatch = findLocalMovie(tmdbMovie, localMovies);
      if (localMatch) {
        addMovie(localMatch, 'tmdb_collection', 75);
      }
    }
  }

  //═══════════════════════════════════════════════════════════════════════════
  // SELECTION PHASE 7: TMDB Lists
  //═══════════════════════════════════════════════════════════════════════════

  if (config.selection.tmdbLists.length > 0) {
    progressCallback?.('Fetching TMDB lists', 0, config.selection.tmdbLists.length);
    const listMovies = await tmdbClient.getListItems(config.selection.tmdbLists);

    progressCallback?.('Matching list movies', 0, listMovies.length);
    for (let i = 0; i < listMovies.length; i++) {
      const tmdbMovie = listMovies[i];
      progressCallback?.('Matching list movies', i + 1, listMovies.length);

      const localMatch = findLocalMovie(tmdbMovie, localMovies);
      if (localMatch) {
        addMovie(localMatch, 'tmdb_list', 60);
      }
    }
  }

  // Calculate genre stats
  for (const item of selectedItems.values()) {
    for (const genre of item.genres) {
      stats.byGenre[genre] = (stats.byGenre[genre] || 0) + 1;
    }
  }

  stats.totalSelected = selectedItems.size;

  return {
    items: Array.from(selectedItems.values()),
    stats,
  };
}


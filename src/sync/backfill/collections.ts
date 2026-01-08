/**
 * Movie Collection Analyzer
 * Detects incomplete movie collections and finds missing movies
 */

import type { TMDBClient } from '../tmdb/client.ts';
import type { MovieInfo } from '../types.ts';
import type { DestinationMovie, MissingMovie, BackfillProgressCallback } from './types.ts';
import type { TMDBMovieDetails, TMDBCollection } from '../tmdb/types.ts';

/** Cache of collection details to avoid repeated API calls */
const collectionCache = new Map<number, TMDBCollection>();

/** Normalize a movie title for matching */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^the/, '')
    .trim();
}

/** Match a destination movie with source library */
function findSourceMovie(destMovie: DestinationMovie, sourceMovies: MovieInfo[]): MovieInfo | undefined {
  const normalizedDest = normalizeTitle(destMovie.title);
  
  // Try exact match first
  for (const source of sourceMovies) {
    if (normalizeTitle(source.title) === normalizedDest) {
      // If years match or no year specified, it's a match
      if (!destMovie.year || !source.year || destMovie.year === source.year) {
        return source;
      }
    }
  }
  
  // Try fuzzy match
  for (const source of sourceMovies) {
    const normalizedSource = normalizeTitle(source.title);
    if (normalizedSource.includes(normalizedDest) || normalizedDest.includes(normalizedSource)) {
      if (!destMovie.year || !source.year || Math.abs(destMovie.year - source.year) <= 1) {
        return source;
      }
    }
  }
  
  return undefined;
}

/** Get collection for a movie (with caching) */
async function getMovieCollection(
  movie: DestinationMovie,
  tmdbClient: TMDBClient,
  sourceMovies: MovieInfo[]
): Promise<{ collectionId: number; collection: TMDBCollection } | undefined> {
  // If we already have collection ID from destination
  if (movie.collectionId && collectionCache.has(movie.collectionId)) {
    return { collectionId: movie.collectionId, collection: collectionCache.get(movie.collectionId)! };
  }

  // Try to get TMDB ID
  let tmdbId = movie.tmdbId;
  
  if (!tmdbId) {
    // Search TMDB for this movie
    try {
      const results = await tmdbClient.searchMovies(movie.title, movie.year);
      if (results.length > 0) {
        // Find best match
        const normalizedTitle = normalizeTitle(movie.title);
        const match = results.find(r => normalizeTitle(r.title) === normalizedTitle) || results[0];
        tmdbId = match.id;
      }
    } catch {
      return undefined;
    }
  }

  if (!tmdbId) return undefined;

  // Get movie details to find collection
  try {
    const details = await tmdbClient.getMovieDetails(tmdbId);
    if (details.belongs_to_collection) {
      const collectionId = details.belongs_to_collection.id;
      
      // Fetch full collection details if not cached
      if (!collectionCache.has(collectionId)) {
        const collection = await tmdbClient.getCollection(collectionId);
        collectionCache.set(collectionId, collection);
      }
      
      return { collectionId, collection: collectionCache.get(collectionId)! };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

/** Find missing movies from collections */
export async function findMissingCollectionMovies(
  destMovies: DestinationMovie[],
  sourceMovies: MovieInfo[],
  tmdbClient: TMDBClient,
  progressCallback?: BackfillProgressCallback
): Promise<MissingMovie[]> {
  const missing: MissingMovie[] = [];
  const processedCollections = new Set<number>();
  
  // Create lookup maps
  const destByTitle = new Map<string, DestinationMovie>();
  for (const movie of destMovies) {
    destByTitle.set(normalizeTitle(movie.title), movie);
  }
  
  const sourceByTitle = new Map<string, MovieInfo>();
  for (const movie of sourceMovies) {
    sourceByTitle.set(normalizeTitle(movie.title), movie);
  }

  let processed = 0;
  for (const destMovie of destMovies) {
    progressCallback?.('Analyzing collections', ++processed, destMovies.length, destMovie.title);
    
    const collectionInfo = await getMovieCollection(destMovie, tmdbClient, sourceMovies);
    if (!collectionInfo || processedCollections.has(collectionInfo.collectionId)) {
      continue;
    }
    
    processedCollections.add(collectionInfo.collectionId);
    const { collectionId, collection } = collectionInfo;
    
    // Check each movie in the collection
    for (const collectionMovie of collection.parts) {
      const normalizedTitle = normalizeTitle(collectionMovie.title);
      
      // Check if this movie is on destination
      if (destByTitle.has(normalizedTitle)) {
        continue; // Already have it
      }
      
      // Check if we have it in source
      const sourceMatch = sourceByTitle.get(normalizedTitle);
      const releaseYear = collectionMovie.release_date 
        ? parseInt(collectionMovie.release_date.split('-')[0], 10)
        : 0;
      
      missing.push({
        title: collectionMovie.title,
        year: releaseYear,
        tmdbId: collectionMovie.id,
        collectionId,
        collectionName: collection.name,
        sourcePath: sourceMatch?.path,
        estimatedSize: sourceMatch?.size || 2000 * 1024 * 1024, // Default 2GB estimate
      });
    }
  }

  // Sort by collection name, then release year
  missing.sort((a, b) => {
    const collCompare = a.collectionName.localeCompare(b.collectionName);
    if (collCompare !== 0) return collCompare;
    return a.year - b.year;
  });

  return missing;
}


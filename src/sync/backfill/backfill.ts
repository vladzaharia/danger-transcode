/**
 * Backfill Orchestrator
 * Main entry point for backfilling missing episodes, collection movies, and metadata
 */

import { join, basename, dirname } from 'https://deno.land/std@0.224.0/path/mod.ts';
import type {
  BackfillOptions,
  BackfillAnalysis,
  BackfillResult,
  BackfillStats,
  BackfillProgressCallback,
  MissingEpisode,
  MissingMovie,
} from './types.ts';
import { scanDestination } from './scanner.ts';
import { findAllMissingEpisodes } from './episodes.ts';
import { findMissingCollectionMovies } from './collections.ts';
import { scanLibraries } from '../selection/scanner.ts';
import { scanForMissingMetadata, fillMissingMetadata } from '../metadata/fetcher.ts';
import { TMDBClient } from '../tmdb/client.ts';
import { copyFileWithProgress } from '../pipeline/copier.ts';

/** Format bytes as human-readable string */
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/** Analyze destination for missing content */
export async function analyzeBackfill(
  options: BackfillOptions,
  progressCallback?: BackfillProgressCallback
): Promise<BackfillAnalysis> {
  const tmdbClient = new TMDBClient({ apiKey: options.tmdbApiKey });

  // Scan source libraries
  progressCallback?.('Scanning source libraries', 0, 1, 'Starting...');
  const sourceLibrary = await scanLibraries(options.sourceMediaDirs, progressCallback);

  // Scan destination for existing content
  progressCallback?.('Scanning destination', 0, 1, 'Starting...');
  const destContent = await scanDestination(options.destinationDirs, progressCallback);

  console.log(`\nFound on destination:`);
  console.log(`  ${destContent.tvShows.length} TV shows`);
  console.log(`  ${destContent.movies.length} movies\n`);

  // Find missing episodes
  progressCallback?.('Finding missing episodes', 0, 1, 'Analyzing...');
  const missingEpisodes = await findAllMissingEpisodes(
    destContent.tvShows,
    sourceLibrary.tvShows,
    tmdbClient,
    progressCallback
  );

  // Find missing collection movies
  progressCallback?.('Finding missing collection movies', 0, 1, 'Analyzing...');
  const missingMovies = await findMissingCollectionMovies(
    destContent.movies,
    sourceLibrary.movies,
    tmdbClient,
    progressCallback
  );

  // Calculate statistics
  const episodesWithSource = missingEpisodes.filter(e => e.sourcePath).length;
  const moviesWithSource = missingMovies.filter(m => m.sourcePath).length;
  
  const totalEstimatedSize = 
    missingEpisodes.reduce((sum, e) => sum + e.estimatedSize, 0) +
    missingMovies.reduce((sum, m) => sum + m.estimatedSize, 0);

  // Count unique shows with gaps
  const showsWithGaps = new Set(missingEpisodes.map(e => e.showTitle)).size;
  const seasonsWithGaps = new Set(
    missingEpisodes.map(e => `${e.showTitle}:${e.seasonNumber}`)
  ).size;
  const collectionsIncomplete = new Set(missingMovies.map(m => m.collectionId)).size;

  const stats: BackfillStats = {
    tvShowsAnalyzed: destContent.tvShows.length,
    seasonsWithGaps,
    totalMissingEpisodes: missingEpisodes.length,
    incompleteCollections: collectionsIncomplete,
    totalMissingMovies: missingMovies.length,
    itemsWithSource: episodesWithSource + moviesWithSource,
    itemsWithoutSource: 
      (missingEpisodes.length - episodesWithSource) + 
      (missingMovies.length - moviesWithSource),
  };

  return {
    missingEpisodes,
    missingMovies,
    totalEstimatedSize,
    stats,
  };
}

/** Print backfill analysis summary */
export function printBackfillAnalysis(analysis: BackfillAnalysis): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    BACKFILL ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('📺 Missing Episodes:');
  if (analysis.missingEpisodes.length === 0) {
    console.log('   No missing episodes found!\n');
  } else {
    // Group by show
    const byShow = new Map<string, MissingEpisode[]>();
    for (const ep of analysis.missingEpisodes) {
      const list = byShow.get(ep.showTitle) || [];
      list.push(ep);
      byShow.set(ep.showTitle, list);
    }

    for (const [showTitle, episodes] of byShow) {
      console.log(`\n   ${showTitle}:`);
      // Group by season
      const bySeason = new Map<number, MissingEpisode[]>();
      for (const ep of episodes) {
        const list = bySeason.get(ep.seasonNumber) || [];
        list.push(ep);
        bySeason.set(ep.seasonNumber, list);
      }
      for (const [season, eps] of bySeason) {
        const epNums = eps.map(e => e.episodeNumber).join(', ');
        const hasSource = eps.every(e => e.sourcePath) ? '✓' : eps.some(e => e.sourcePath) ? '~' : '✗';
        console.log(`     Season ${season}: Episodes ${epNums} [${hasSource}]`);
      }
    }
    console.log('');
  }

  console.log('🎬 Missing Collection Movies:');
  if (analysis.missingMovies.length === 0) {
    console.log('   All collections are complete!\n');
  } else {
    // Group by collection
    const byCollection = new Map<string, MissingMovie[]>();
    for (const movie of analysis.missingMovies) {
      const list = byCollection.get(movie.collectionName) || [];
      list.push(movie);
      byCollection.set(movie.collectionName, list);
    }

    for (const [collName, movies] of byCollection) {
      console.log(`\n   ${collName}:`);
      for (const movie of movies) {
        const hasSource = movie.sourcePath ? '✓' : '✗';
        console.log(`     - ${movie.title} (${movie.year}) [${hasSource}]`);
      }
    }
    console.log('');
  }

  console.log('📊 Summary:');
  console.log(`   TV Shows analyzed: ${analysis.stats.tvShowsAnalyzed}`);
  console.log(`   Seasons with gaps: ${analysis.stats.seasonsWithGaps}`);
  console.log(`   Missing episodes: ${analysis.stats.totalMissingEpisodes}`);
  console.log(`   Incomplete collections: ${analysis.stats.incompleteCollections}`);
  console.log(`   Missing movies: ${analysis.stats.totalMissingMovies}`);
  console.log(`   Items available in source: ${analysis.stats.itemsWithSource}`);
  console.log(`   Items not in source: ${analysis.stats.itemsWithoutSource}`);
  console.log(`   Estimated total size: ${formatSize(analysis.totalEstimatedSize)}`);
  console.log('');
  console.log('   Legend: ✓ = available in source, ✗ = not available, ~ = partial');
  console.log('');
}

/** Execute backfill operation */
export async function executeBackfill(
  analysis: BackfillAnalysis,
  options: BackfillOptions,
  progressCallback?: BackfillProgressCallback
): Promise<BackfillResult> {
  const result: BackfillResult = {
    episodesBackfilled: 0,
    moviesBackfilled: 0,
    metadataFilled: 0,
    failures: [],
    totalBytesCopied: 0,
  };

  if (options.dryRun) {
    console.log('🔍 Dry run mode - no files will be copied\n');
    return result;
  }

  const tmdbClient = new TMDBClient({ apiKey: options.tmdbApiKey });

  // Copy missing episodes that have source
  const episodesToCopy = analysis.missingEpisodes.filter(e => e.sourcePath);
  let processed = 0;

  for (const episode of episodesToCopy) {
    progressCallback?.('Copying episodes', ++processed, episodesToCopy.length,
      `${episode.showTitle} S${episode.seasonNumber}E${episode.episodeNumber}`);

    try {
      // Determine destination path
      // Find the show directory on destination
      const destContent = await scanDestination(options.destinationDirs);
      const destShow = destContent.tvShows.find(
        s => s.title.toLowerCase() === episode.showTitle.toLowerCase()
      );

      if (destShow) {
        const seasonFolder = `Season ${episode.seasonNumber.toString().padStart(2, '0')}`;
        const destSeasonPath = join(destShow.path, seasonFolder);

        // Ensure season folder exists
        await Deno.mkdir(destSeasonPath, { recursive: true });

        // Copy the file
        const filename = basename(episode.sourcePath!);
        const destPath = join(destSeasonPath, filename);

        await copyFileWithProgress(episode.sourcePath!, destPath, (progress) => {
          // Progress callback for individual file
        });

        result.episodesBackfilled++;
        result.totalBytesCopied += episode.estimatedSize;
      }
    } catch (error) {
      result.failures.push({
        path: episode.sourcePath!,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Copy missing movies that have source
  const moviesToCopy = analysis.missingMovies.filter(m => m.sourcePath);
  processed = 0;

  for (const movie of moviesToCopy) {
    progressCallback?.('Copying movies', ++processed, moviesToCopy.length, movie.title);

    try {
      // Movies typically go to the first destination directory
      const destDir = options.destinationDirs[0];
      const movieFolder = `${movie.title} (${movie.year})`;
      const destMoviePath = join(destDir, 'Movies', movieFolder);

      // Ensure movie folder exists
      await Deno.mkdir(destMoviePath, { recursive: true });

      // Copy the file
      const filename = basename(movie.sourcePath!);
      const destPath = join(destMoviePath, filename);

      await copyFileWithProgress(movie.sourcePath!, destPath, (progress) => {
        // Progress callback for individual file
      });

      result.moviesBackfilled++;
      result.totalBytesCopied += movie.estimatedSize;
    } catch (error) {
      result.failures.push({
        path: movie.sourcePath!,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Fill metadata if requested
  if (options.fillMetadata) {
    progressCallback?.('Filling metadata', 0, 1, 'Scanning...');

    const itemsWithMissingMetadata: { path: string; status: Awaited<ReturnType<typeof scanForMissingMetadata>>[0]['status'] }[] = [];

    for (const destDir of options.destinationDirs) {
      const items = await scanForMissingMetadata(destDir);
      itemsWithMissingMetadata.push(...items);
    }

    if (itemsWithMissingMetadata.length > 0) {
      const filled = await fillMissingMetadata(
        itemsWithMissingMetadata,
        tmdbClient,
        (current, total, item) => {
          progressCallback?.('Filling metadata', current, total, item);
        }
      );
      result.metadataFilled = filled;
    }
  }

  return result;
}

/** Print backfill result summary */
export function printBackfillResult(result: BackfillResult): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    BACKFILL COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`✅ Episodes backfilled: ${result.episodesBackfilled}`);
  console.log(`✅ Movies backfilled: ${result.moviesBackfilled}`);
  console.log(`✅ Metadata filled: ${result.metadataFilled}`);
  console.log(`📦 Total data copied: ${formatSize(result.totalBytesCopied)}`);

  if (result.failures.length > 0) {
    console.log(`\n❌ Failures: ${result.failures.length}`);
    for (const failure of result.failures.slice(0, 5)) {
      console.log(`   ${failure.path}: ${failure.error}`);
    }
    if (result.failures.length > 5) {
      console.log(`   ... and ${result.failures.length - 5} more`);
    }
  }
  console.log('');
}


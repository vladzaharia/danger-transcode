/**
 * Sync Pipeline
 * Orchestrates the complete sync process
 */

import { join, basename, dirname, extname } from 'https://deno.land/std@0.224.0/path/mod.ts';
import type {
  SyncConfig,
  SyncItem,
  SyncProgress,
  SyncResult,
  SyncSummary,
  SyncProgressCallback,
  AllocationPlan,
  DriveAllocation,
} from '../types.ts';
import { TMDBClient } from '../tmdb/client.ts';
import { scanLibraries } from '../selection/scanner.ts';
import { selectMedia } from '../selection/matcher.ts';
import { updateEstimatedSizes } from '../space/estimator.ts';
import { createAllocationPlan, printAllocationPlan } from '../space/allocator.ts';
import { fetchMovieMetadata, fetchTVShowMetadata } from '../metadata/fetcher.ts';
import { copyFileWithProgress, moveFile, ensureDir, cleanupTempDir } from './copier.ts';
import { transcodeFile } from '../../transcode/transcoder.ts';
import type { Config, MediaFile } from '../../transcode/types.ts';
import { probeMediaFile } from '../../transcode/ffprobe.ts';

/** Sync pipeline state */
interface SyncState {
  config: SyncConfig;
  transcoderConfig: Config;
  tmdbClient: TMDBClient;
  allocationPlan: AllocationPlan;
  results: SyncResult[];
  startTime: Date;
}

/** Initialize sync pipeline */
export async function initializeSyncPipeline(
  syncConfig: SyncConfig,
  transcoderConfig: Config
): Promise<SyncState> {
  const tmdbClient = new TMDBClient({
    apiKey: syncConfig.tmdbApiKey,
    readAccessToken: syncConfig.tmdbReadAccessToken,
  });

  return {
    config: syncConfig,
    transcoderConfig,
    tmdbClient,
    allocationPlan: {
      allocations: [],
      unallocatedItems: [],
      totalItemsAllocated: 0,
      totalSizeAllocated: 0,
      warnings: [],
    },
    results: [],
    startTime: new Date(),
  };
}

/** Run the discovery and selection phase */
export async function runDiscoveryPhase(
  state: SyncState,
  progressCallback?: (phase: string, current: number, total: number, item: string) => void
): Promise<SyncItem[]> {
  progressCallback?.('Scanning libraries', 0, 1, 'Starting...');

  // Scan source libraries
  const scanResult = await scanLibraries(state.config.sourceMediaDirs, progressCallback);

  console.log(`\nFound ${scanResult.totalMovies} movies and ${scanResult.totalTVShows} TV shows`);
  console.log(`Total: ${scanResult.totalSeasons} seasons, ${scanResult.totalEpisodes} episodes`);

  // Select media based on criteria
  progressCallback?.('Selecting media', 0, 1, 'Matching against criteria...');

  const selectionResult = await selectMedia(
    state.config,
    scanResult.movies,
    scanResult.tvShows,
    state.tmdbClient,
    (phase, current, total) => progressCallback?.(phase, current, total, '')
  );

  console.log(`\nSelected ${selectionResult.stats.totalSelected} items:`);
  console.log(`  Movies: ${selectionResult.stats.movies}`);
  console.log(`  TV Seasons: ${selectionResult.stats.tvShows}`);
  console.log('\nBy source:');
  for (const [source, count] of Object.entries(selectionResult.stats.bySource)) {
    if (count > 0) {
      console.log(`  ${source}: ${count}`);
    }
  }

  return selectionResult.items;
}

/** Run the space planning phase */
export async function runPlanningPhase(
  state: SyncState,
  items: SyncItem[],
  progressCallback?: (phase: string, current: number, total: number, item: string) => void
): Promise<AllocationPlan> {
  progressCallback?.('Estimating sizes', 0, items.length, 'Calculating...');

  // Update estimated sizes based on transcoding settings
  updateEstimatedSizes(items, state.transcoderConfig.bitrates);

  progressCallback?.('Creating allocation plan', 0, 1, 'Running bin-packing...');

  // Create allocation plan
  const plan = await createAllocationPlan(items, state.config.destinations);
  state.allocationPlan = plan;

  // Print plan summary
  printAllocationPlan(plan);

  return plan;
}

/** Create a MediaFile object from a source path for transcoding */
async function createMediaFileFromPath(
  sourcePath: string,
  mediaType: 'movie' | 'tv',
  config: Config
): Promise<MediaFile> {
  const probeResult = await probeMediaFile(config, sourcePath);

  const width = probeResult.video?.width || 1920;
  const height = probeResult.video?.height || 1080;
  const targetHeight = mediaType === 'tv' ? config.tvMaxHeight : config.movieMaxHeight;
  const targetWidth = Math.round((width / height) * targetHeight);

  return {
    path: sourcePath,
    type: mediaType === 'tv' ? 'tv' : 'movie',
    codec: probeResult.video?.codec_name || 'unknown',
    width,
    height,
    size: probeResult.fileSize,
    duration: probeResult.duration,
    bitrate: probeResult.video?.bit_rate ? parseInt(probeResult.video.bit_rate, 10) : undefined,
    needsTranscode: true,
    targetWidth: Math.min(targetWidth, width),
    targetHeight: Math.min(targetHeight, height),
  };
}

/** Process a single sync item */
async function processSyncItem(
  item: SyncItem,
  allocation: DriveAllocation,
  state: SyncState,
  progressCallback?: SyncProgressCallback
): Promise<SyncResult> {
  const startTime = Date.now();
  const progress: SyncProgress = {
    itemId: item.id,
    title: item.title,
    status: 'pending',
    progress: 0,
    currentStep: 'Starting...',
  };

  progressCallback?.(progress);

  try {
    // Determine destination path
    const destBase = allocation.drive.path;
    let destDir: string;

    if (item.type === 'movie') {
      // Movies go in: /Movies/Title (Year)/
      const movieFolder = item.year ? `${item.title} (${item.year})` : item.title;
      destDir = join(destBase, 'Movies', movieFolder);
    } else {
      // TV shows go in: /TV Shows/Show Name/Season XX/
      const showFolder = item.title;
      const seasonFolder = `Season ${(item.seasonNumber || 1).toString().padStart(2, '0')}`;
      destDir = join(destBase, 'TV Shows', showFolder, seasonFolder);
    }

    await ensureDir(destDir);

    // Create temp directory for this item
    const tempDir = join(state.config.tempDir, `sync_${Date.now()}_${item.id.replace(/[^a-z0-9]/gi, '_')}`);
    await ensureDir(tempDir);

    // Create a modified config with our temp directory
    const transcodeConfig: Config = {
      ...state.transcoderConfig,
      tempDir: tempDir,
    };

    try {
      // Step 1: Copy source to temp
      progress.status = 'copying';
      progress.currentStep = 'Copying source file...';
      progressCallback?.(progress);

      if (item.type === 'movie') {
        // Single file for movies
        const tempPath = join(tempDir, basename(item.sourcePath));
        await copyFileWithProgress(item.sourcePath, tempPath, (bytes, total) => {
          progress.progress = Math.floor((bytes / total) * 25);
          progress.bytesProcessed = bytes;
          progress.totalBytes = total;
          progressCallback?.(progress);
        });

        // Step 2: Transcode
        progress.status = 'transcoding';
        progress.currentStep = 'Transcoding...';
        progress.progress = 25;
        progressCallback?.(progress);

        // Create MediaFile for the transcoder
        const mediaFile = await createMediaFileFromPath(tempPath, 'movie', transcodeConfig);

        // Transcode using the existing system
        const transcodeResult = await transcodeFile(mediaFile, transcodeConfig);

        if (!transcodeResult.success) {
          throw new Error(transcodeResult.error || 'Transcode failed');
        }

        // Step 3: Fetch metadata
        progress.status = 'metadata';
        progress.currentStep = 'Fetching metadata...';
        progress.progress = 75;
        progressCallback?.(progress);

        await fetchMovieMetadata(item, tempDir, state.tmdbClient);

        // Step 4: Move to final destination
        progress.status = 'moving';
        progress.currentStep = 'Moving to destination...';
        progress.progress = 90;
        progressCallback?.(progress);

        // Find the transcoded output file (the transcoder creates it in tempDir)
        let transcodedFile: string | null = null;
        for await (const entry of Deno.readDir(tempDir)) {
          if (entry.isFile && entry.name.endsWith('.transcoding.mkv')) {
            transcodedFile = join(tempDir, entry.name);
            break;
          }
        }

        if (!transcodedFile) {
          throw new Error('Transcoded file not found');
        }

        const outputFilename = basename(item.sourcePath, extname(item.sourcePath)) + '.mkv';
        const finalPath = join(destDir, outputFilename);
        await moveFile(transcodedFile, finalPath);

        // Move metadata files
        for await (const entry of Deno.readDir(tempDir)) {
          if (entry.isFile && !entry.name.includes('.transcoding') && entry.name !== basename(item.sourcePath)) {
            const srcPath = join(tempDir, entry.name);
            const dstPath = join(destDir, entry.name);
            try {
              await moveFile(srcPath, dstPath);
            } catch {
              // Ignore errors for metadata files
            }
          }
        }

        // Get final size
        const finalStat = await Deno.stat(finalPath);

        progress.status = 'complete';
        progress.progress = 100;
        progress.currentStep = 'Complete';
        progressCallback?.(progress);

        return {
          itemId: item.id,
          success: true,
          destPath: finalPath,
          transcodedSize: finalStat.size,
          duration: Date.now() - startTime,
        };
      } else {
        // TV season - process each episode
        const episodeResults: { path: string; size: number }[] = [];

        for (let i = 0; i < (item.episodes?.length || 0); i++) {
          const episode = item.episodes![i];
          const episodeProgress = (i / item.episodes!.length) * 75;

          progress.currentStep = `Processing episode ${episode.episodeNumber}...`;
          progress.progress = Math.floor(episodeProgress);
          progressCallback?.(progress);

          // Copy episode
          const tempEpisodePath = join(tempDir, basename(episode.path));
          await copyFileWithProgress(episode.path, tempEpisodePath);

          // Create MediaFile for the transcoder
          const mediaFile = await createMediaFileFromPath(tempEpisodePath, 'tv', transcodeConfig);

          // Transcode episode
          progress.status = 'transcoding';
          const transcodeResult = await transcodeFile(mediaFile, transcodeConfig);

          if (!transcodeResult.success) {
            throw new Error(`Episode ${episode.episodeNumber} transcode failed: ${transcodeResult.error}`);
          }

          // Find the transcoded output file
          let transcodedFile: string | null = null;
          for await (const entry of Deno.readDir(tempDir)) {
            if (entry.isFile && entry.name.includes('.transcoding.mkv')) {
              transcodedFile = join(tempDir, entry.name);
              break;
            }
          }

          if (!transcodedFile) {
            throw new Error(`Transcoded file not found for episode ${episode.episodeNumber}`);
          }

          // Move to destination
          const outputFilename = basename(episode.path, extname(episode.path)) + '.mkv';
          const finalPath = join(destDir, outputFilename);
          await moveFile(transcodedFile, finalPath);

          const finalStat = await Deno.stat(finalPath);
          episodeResults.push({ path: finalPath, size: finalStat.size });
        }

        // Fetch TV show metadata
        progress.status = 'metadata';
        progress.currentStep = 'Fetching metadata...';
        progress.progress = 85;
        progressCallback?.(progress);

        const showDir = dirname(destDir);
        await fetchTVShowMetadata(item, showDir, state.tmdbClient);

        progress.status = 'complete';
        progress.progress = 100;
        progress.currentStep = 'Complete';
        progressCallback?.(progress);

        const totalSize = episodeResults.reduce((sum, r) => sum + r.size, 0);

        return {
          itemId: item.id,
          success: true,
          destPath: destDir,
          transcodedSize: totalSize,
          duration: Date.now() - startTime,
        };
      }
    } finally {
      // Clean up temp directory
      await cleanupTempDir(tempDir);
    }
  } catch (error) {
    progress.status = 'failed';
    progress.error = error instanceof Error ? error.message : String(error);
    progressCallback?.(progress);

    return {
      itemId: item.id,
      success: false,
      error: progress.error,
      duration: Date.now() - startTime,
    };
  }
}

/** Run the sync phase */
export async function runSyncPhase(
  state: SyncState,
  progressCallback?: SyncProgressCallback
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  for (const allocation of state.allocationPlan.allocations) {
    for (const item of allocation.allocatedItems) {
      if (state.config.dryRun) {
        console.log(`[DRY RUN] Would sync: ${item.title} to ${allocation.drive.label}`);
        results.push({
          itemId: item.id,
          success: true,
          destPath: join(allocation.drive.path, item.title),
          transcodedSize: item.estimatedSize,
          duration: 0,
        });
      } else {
        const result = await processSyncItem(item, allocation, state, progressCallback);
        results.push(result);
      }
    }
  }

  state.results = results;
  return results;
}

/** Generate sync summary */
export function generateSyncSummary(state: SyncState): SyncSummary {
  const endTime = new Date();
  const successful = state.results.filter((r) => r.success);
  const failed = state.results.filter((r) => !r.success);

  return {
    startTime: state.startTime.toISOString(),
    endTime: endTime.toISOString(),
    totalItems: state.results.length,
    successfulItems: successful.length,
    failedItems: failed.length,
    totalBytesTransferred: successful.reduce((sum, r) => sum + (r.transcodedSize || 0), 0),
    totalBytesSaved: 0, // Would need original sizes to calculate
    results: state.results,
    warnings: state.allocationPlan.warnings,
  };
}

/** Print sync summary */
export function printSyncSummary(summary: SyncSummary): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                      SYNC SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const duration = new Date(summary.endTime).getTime() - new Date(summary.startTime).getTime();
  const durationMin = Math.floor(duration / 60000);
  const durationSec = Math.floor((duration % 60000) / 1000);

  console.log(`Duration: ${durationMin}m ${durationSec}s`);
  console.log(`Total Items: ${summary.totalItems}`);
  console.log(`  ✓ Successful: ${summary.successfulItems}`);
  console.log(`  ✗ Failed: ${summary.failedItems}`);
  console.log(`Total Size: ${formatBytes(summary.totalBytesTransferred)}`);

  if (summary.failedItems > 0) {
    console.log('\nFailed Items:');
    for (const result of summary.results.filter((r) => !r.success)) {
      console.log(`  - ${result.itemId}: ${result.error}`);
    }
  }

  if (summary.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of summary.warnings) {
      console.log(`  ⚠️  ${warning}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

/** Format bytes helper */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}


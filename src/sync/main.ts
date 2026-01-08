/**
 * Sync Module Main Entry Point
 * Provides CLI interface for portable media sync
 */

import { parse } from 'https://deno.land/std@0.224.0/flags/mod.ts';
import { join } from 'https://deno.land/std@0.224.0/path/mod.ts';
import type { SyncConfig, SyncProgress } from './types.ts';
import type { Config } from '../transcode/types.ts';
import {
  initializeSyncPipeline,
  runDiscoveryPhase,
  runPlanningPhase,
  runSyncPhase,
  generateSyncSummary,
  printSyncSummary,
} from './pipeline/sync.ts';
import { scanForMissingMetadata, fillMissingMetadata } from './metadata/fetcher.ts';
import { TMDBClient } from './tmdb/client.ts';
import {
  analyzeBackfill,
  printBackfillAnalysis,
  executeBackfill,
  printBackfillResult,
  type BackfillOptions,
} from './backfill/mod.ts';
import {
  loadUnifiedConfig,
  toLegacySyncConfig,
  DEFAULT_SYNC_CONFIG,
} from '../shared/config.ts';

/**
 * Default sync configuration
 * @deprecated Use loadUnifiedConfig from shared/config.ts
 */
export function getDefaultSyncConfig(): SyncConfig {
  const defaultConfig = DEFAULT_SYNC_CONFIG;
  return {
    sourceMediaDirs: [],
    destinations: defaultConfig.destinations,
    tmdbApiKey: defaultConfig.tmdbApiKey,
    selection: defaultConfig.selection,
    genreDistribution: defaultConfig.genreDistribution,
    tempDir: '/tmp/danger-transcode-sync',
    syncDatabasePath: defaultConfig.syncDatabasePath,
    openSubtitlesApiKey: defaultConfig.openSubtitlesApiKey,
    downloadMissingMetadata: defaultConfig.downloadMissingMetadata,
    maxConcurrency: 1,
    dryRun: false,
  };
}

/**
 * Load sync configuration from file
 * Now uses unified config system - supports both legacy and new formats
 */
export async function loadSyncConfig(configPath?: string): Promise<SyncConfig> {
  try {
    const unifiedConfig = await loadUnifiedConfig(configPath);
    return toLegacySyncConfig(unifiedConfig);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`Sync config file not found: ${configPath}`);
    }
    throw error;
  }
}

/** Save sync configuration to file */
export async function saveSyncConfig(config: SyncConfig, configPath: string): Promise<void> {
  await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2));
}

/** Progress display for CLI */
function displayProgress(progress: SyncProgress): void {
  const statusEmoji: Record<string, string> = {
    pending: '⏳',
    copying: '📋',
    transcoding: '🎬',
    metadata: '📝',
    moving: '📦',
    complete: '✅',
    failed: '❌',
  };

  const emoji = statusEmoji[progress.status] || '•';
  const progressBar = createProgressBar(progress.progress, 30);

  // Clear line and print progress
  Deno.stdout.writeSync(new TextEncoder().encode(
    `\r${emoji} ${progress.title.substring(0, 30).padEnd(30)} ${progressBar} ${progress.progress}% - ${progress.currentStep}`
  ));

  if (progress.status === 'complete' || progress.status === 'failed') {
    console.log(''); // New line after completion
  }
}

/** Create ASCII progress bar */
function createProgressBar(percent: number, width: number): string {
  const filled = Math.floor((percent / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

/** Run full sync process */
export async function runSync(
  syncConfig: SyncConfig,
  transcoderConfig: Config
): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              DANGER TRANSCODE - PORTABLE SYNC');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Initialize pipeline
  const state = await initializeSyncPipeline(syncConfig, transcoderConfig);

  // Phase 1: Discovery and Selection
  console.log('📚 Phase 1: Discovery and Selection\n');
  const selectedItems = await runDiscoveryPhase(state, (phase, current, total, item) => {
    if (total > 0) {
      const percent = Math.floor((current / total) * 100);
      Deno.stdout.writeSync(new TextEncoder().encode(
        `\r  ${phase}: ${current}/${total} (${percent}%) ${item.substring(0, 40)}`
      ));
    }
  });
  console.log('\n');

  if (selectedItems.length === 0) {
    console.log('No items selected for sync. Check your configuration and source directories.');
    return;
  }

  // Phase 2: Space Planning
  console.log('📊 Phase 2: Space Planning\n');
  const plan = await runPlanningPhase(state, selectedItems, (phase, current, total, item) => {
    Deno.stdout.writeSync(new TextEncoder().encode(`\r  ${phase}...`));
  });
  console.log('');

  if (plan.totalItemsAllocated === 0) {
    console.log('No items could be allocated. Check destination drive space.');
    return;
  }

  // Confirm before proceeding (unless dry run)
  if (!syncConfig.dryRun) {
    console.log('Press Enter to start sync, or Ctrl+C to cancel...');
    const buf = new Uint8Array(1);
    await Deno.stdin.read(buf);
  }

  // Phase 3: Sync
  console.log('\n🔄 Phase 3: Syncing\n');
  await runSyncPhase(state, displayProgress);

  // Generate and print summary
  const summary = generateSyncSummary(state);
  printSyncSummary(summary);
}

/** Fill missing metadata for existing media */
export async function runMetadataFill(
  destDirs: string[],
  tmdbApiKey: string
): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('           DANGER TRANSCODE - METADATA FILL');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const tmdbClient = new TMDBClient({ apiKey: tmdbApiKey });

  // Scan for items with missing metadata
  console.log('Scanning for items with missing metadata...\n');
  const itemsWithMissingMetadata: { path: string; status: Awaited<ReturnType<typeof scanForMissingMetadata>>[0]['status'] }[] = [];

  for (const destDir of destDirs) {
    console.log(`  Scanning: ${destDir}`);
    const items = await scanForMissingMetadata(destDir, (current, total, item) => {
      Deno.stdout.writeSync(new TextEncoder().encode(`\r    Found ${current} items with missing metadata...`));
    });
    itemsWithMissingMetadata.push(...items);
    console.log('');
  }

  if (itemsWithMissingMetadata.length === 0) {
    console.log('\n✅ All media has complete metadata!');
    return;
  }

  console.log(`\nFound ${itemsWithMissingMetadata.length} items with missing metadata.`);
  console.log('Filling missing metadata...\n');

  const filled = await fillMissingMetadata(
    itemsWithMissingMetadata,
    tmdbClient,
    (current, total, item) => {
      const percent = Math.floor((current / total) * 100);
      Deno.stdout.writeSync(new TextEncoder().encode(
        `\r  Processing: ${current}/${total} (${percent}%) ${item.substring(0, 40).padEnd(40)}`
      ));
    }
  );

  console.log(`\n\n✅ Filled metadata for ${filled} items.`);
}

/** Backfill missing episodes, collection movies, and metadata */
export async function runBackfill(
  options: BackfillOptions
): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              DANGER TRANSCODE - BACKFILL');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Progress callback for CLI
  const progressCallback = (phase: string, current: number, total: number, item: string) => {
    if (total > 0) {
      const percent = Math.floor((current / total) * 100);
      Deno.stdout.writeSync(new TextEncoder().encode(
        `\r  ${phase}: ${current}/${total} (${percent}%) ${item.substring(0, 40).padEnd(40)}`
      ));
    } else {
      Deno.stdout.writeSync(new TextEncoder().encode(`\r  ${phase}: ${item.substring(0, 50)}`));
    }
  };

  // Analyze what's missing
  console.log('📊 Analyzing destination for gaps...\n');
  const analysis = await analyzeBackfill(options, progressCallback);
  console.log(''); // New line after progress

  // Print analysis
  printBackfillAnalysis(analysis);

  // If nothing to backfill, exit early
  const totalMissing = analysis.stats.totalMissingEpisodes + analysis.stats.totalMissingMovies;
  const itemsWithSource = analysis.stats.itemsWithSource;

  if (totalMissing === 0) {
    console.log('✅ No gaps found! All content is complete.\n');

    // Still run metadata fill if requested
    if (options.fillMetadata) {
      await runMetadataFill(options.destinationDirs, options.tmdbApiKey);
    }
    return;
  }

  if (itemsWithSource === 0) {
    console.log('⚠️  Missing content found, but none available in source libraries.\n');
    console.log('   Add more content to source directories, or manually acquire missing items.\n');

    // Still run metadata fill if requested
    if (options.fillMetadata) {
      await runMetadataFill(options.destinationDirs, options.tmdbApiKey);
    }
    return;
  }

  // Confirm before proceeding (unless dry run)
  if (!options.dryRun) {
    console.log(`Ready to backfill ${itemsWithSource} items from source libraries.`);
    console.log('Press Enter to continue, or Ctrl+C to cancel...');
    const buf = new Uint8Array(1);
    await Deno.stdin.read(buf);
  }

  // Execute backfill
  console.log('\n🔄 Executing backfill...\n');
  const result = await executeBackfill(analysis, options, progressCallback);
  console.log(''); // New line after progress

  // Print result
  printBackfillResult(result);
}

/** Export all public functions and types */
export { TMDBClient } from './tmdb/client.ts';
export { scanLibraries } from './selection/scanner.ts';
export { selectMedia } from './selection/matcher.ts';
export { createAllocationPlan, printAllocationPlan } from './space/allocator.ts';
export type { SyncConfig, SyncItem, AllocationPlan, SyncSummary } from './types.ts';
export type { BackfillOptions, BackfillAnalysis, BackfillResult } from './backfill/mod.ts';
export { analyzeBackfill, printBackfillAnalysis, executeBackfill, printBackfillResult } from './backfill/mod.ts';

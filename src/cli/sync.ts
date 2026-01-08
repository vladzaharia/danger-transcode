/**
 * Sync CLI Actions
 * Handles the sync and backfill subcommands
 */

import { loadConfig } from '../transcode/config.ts';
import { createLogger, type LogLevel, setGlobalLogger } from '../shared/logger.ts';
import { loadSyncConfig, runSync, runBackfill } from '../sync/main.ts';

/** Options for the sync command */
export interface SyncOptions {
  config?: string;
  dryRun?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  logLevel?: string;
  syncConfig?: string;
  tmdbKey?: string;
  concurrency?: number;
}

/** Options for the backfill command */
export interface BackfillOptions {
  config?: string;
  dryRun?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  logLevel?: string;
  tmdbKey?: string;
  syncConfig?: string;
  noMetadata?: boolean;
  concurrency?: number;
}

/** Sync action handler */
export async function syncAction(options: SyncOptions): Promise<void> {
  // Setup logger
  const logLevel: LogLevel = options.quiet ? 'error' : options.verbose ? 'debug' : ((options.logLevel as LogLevel) || 'info');
  const logger = createLogger({ level: logLevel });
  setGlobalLogger(logger);

  logger.info('danger-transcode sync starting...');

  // Get TMDB API key
  const tmdbKey = options.tmdbKey || Deno.env.get('TMDB_API_KEY');
  const syncConfigPath = options.syncConfig || './sync-config.json';

  try {
    // Load sync configuration
    const syncConfig = await loadSyncConfig(syncConfigPath);

    // Override TMDB key if provided via CLI
    if (tmdbKey) {
      syncConfig.tmdbApiKey = tmdbKey;
    }

    if (!syncConfig.tmdbApiKey) {
      logger.error('TMDB API key required. Use --tmdb-key or set TMDB_API_KEY environment variable.');
      Deno.exit(1);
    }

    // Apply CLI overrides
    if (options.dryRun) {
      syncConfig.dryRun = true;
    }
    if (options.concurrency) {
      syncConfig.maxConcurrency = options.concurrency;
    }

    // Load transcoder config
    const transcoderConfig = await loadConfig(options.config);

    // Run sync
    await runSync(syncConfig, transcoderConfig);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      logger.error(`Sync config not found: ${syncConfigPath}`);
      logger.info('Create a sync-config.json file or specify path with --sync-config');
      logger.info('See sync-config.example.json for an example configuration.');
    } else {
      logger.error('Sync failed:', error);
    }
    Deno.exit(1);
  }
}

/** Backfill action handler */
export async function backfillAction(
  options: BackfillOptions,
  ...directories: string[]
): Promise<void> {
  // Setup logger
  const logLevel: LogLevel = options.quiet ? 'error' : options.verbose ? 'debug' : ((options.logLevel as LogLevel) || 'info');
  const logger = createLogger({ level: logLevel });
  setGlobalLogger(logger);

  logger.info('danger-transcode backfill starting...');

  // Get TMDB API key
  const tmdbKey = options.tmdbKey || Deno.env.get('TMDB_API_KEY');

  if (!tmdbKey) {
    logger.error('TMDB API key required. Use --tmdb-key or set TMDB_API_KEY environment variable.');
    Deno.exit(1);
  }

  if (directories.length === 0) {
    logger.error('Please specify at least one destination directory to analyze.');
    Deno.exit(1);
  }

  try {
    // Load sync config to get source directories
    const syncConfigPath = options.syncConfig || './sync-config.json';
    let sourceMediaDirs: string[] = [];

    try {
      const syncConfig = await loadSyncConfig(syncConfigPath);
      sourceMediaDirs = syncConfig.sourceMediaDirs;
    } catch {
      logger.warn(`Could not load sync config from ${syncConfigPath}`);
      logger.warn('No source directories configured - will only analyze gaps, cannot backfill content');
    }

    await runBackfill({
      tmdbApiKey: tmdbKey,
      sourceMediaDirs,
      destinationDirs: directories,
      fillMetadata: !options.noMetadata,
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 1,
    });
  } catch (error) {
    logger.error('Backfill failed:', error);
    Deno.exit(1);
  }
}


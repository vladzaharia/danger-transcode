#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net

/**
 * danger-transcode - Hardware-accelerated media transcoding for Rockchip devices
 *
 * Main entry point with CLI handling using Cliffy
 */

import { Command, EnumType } from '@cliffy/command';
import { transcodeAction } from './cli/transcode.ts';
import { syncAction, backfillAction } from './cli/sync.ts';

const VERSION = '1.0.0';

/** Log level enum type */
const logLevelType = new EnumType(['debug', 'info', 'warn', 'error']);

/** Main CLI application */
const cli = new Command()
  .name('danger-transcode')
  .version(VERSION)
  .description('Hardware-accelerated media transcoding for Rockchip devices')
  .globalType('log-level', logLevelType)
  .globalOption('-c, --config <path:string>', 'Path to transcoder configuration file')
  .globalOption('-n, --dry-run', 'Simulate without making changes')
  .globalOption('--verbose', 'Enable verbose output')
  .globalOption('--quiet', 'Suppress non-error output')
  .globalOption('--log-level <level:log-level>', 'Set log level', { default: 'info' });

/**
 * TRANSCODE command - Convert media files in-place
 */
cli.command('transcode', 'Transcode media files in-place to HEVC')
  .alias('t')
  .option('--media-dirs <dirs:string>', 'Comma-separated list of media directories')
  .option('--concurrency <n:number>', 'Number of concurrent transcodes', { default: 1 })
  .option('--clear-errors', 'Clear error records and retry failed files')
  .option('--list-errors', 'List files that failed to transcode')
  .example('Basic usage', 'danger-transcode transcode')
  .example('Specific directories', 'danger-transcode transcode --media-dirs /mnt/movies,/mnt/tv')
  .example('Preview changes', 'danger-transcode transcode --dry-run --verbose')
  .example('Clear failed files', 'danger-transcode transcode --clear-errors')
  .action(transcodeAction);

/**
 * SYNC command - Sync media to portable drives with transcoding
 */
cli.command('sync', 'Sync and transcode media to portable drives')
  .alias('s')
  .option('--sync-config <path:string>', 'Path to sync configuration file', {
    default: './sync-config.json',
  })
  .option('--tmdb-key <key:string>', 'TMDB API key (or set TMDB_API_KEY env var)')
  .option('--concurrency <n:number>', 'Number of concurrent operations', { default: 1 })
  .example('Basic sync', 'danger-transcode sync --sync-config ./sync-config.json')
  .example('With TMDB key', 'danger-transcode sync --tmdb-key YOUR_KEY')
  .example('Preview sync', 'danger-transcode sync --dry-run')
  .action(syncAction);

/**
 * BACKFILL command - Fill missing episodes, collection movies, and metadata
 */
cli.command('backfill <directories...>', 'Backfill missing episodes, collection movies, and metadata')
  .alias('b')
  .option('--tmdb-key <key:string>', 'TMDB API key (required, or set TMDB_API_KEY env var)')
  .option('--sync-config <path:string>', 'Path to sync config for source directories', {
    default: './sync-config.json',
  })
  .option('--no-metadata', 'Skip filling missing metadata')
  .option('--concurrency <n:number>', 'Number of concurrent operations', { default: 1 })
  .example('Analyze gaps', 'danger-transcode backfill /mnt/portable --tmdb-key YOUR_KEY --dry-run')
  .example('Backfill all', 'danger-transcode backfill /mnt/portable --tmdb-key YOUR_KEY')
  .example('Skip metadata', 'danger-transcode backfill /mnt/portable --no-metadata --tmdb-key KEY')
  .action(backfillAction);

// Run CLI
if (import.meta.main) {
  // Show help if no command provided
  if (Deno.args.length === 0) {
    cli.showHelp();
    Deno.exit(0);
  }
  await cli.parse(Deno.args);
}

export { cli, VERSION };

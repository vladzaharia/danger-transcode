#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

/**
 * danger-transcode - Hardware-accelerated media transcoding for Rockchip devices
 *
 * Main entry point with CLI handling
 */

import { parseArgs } from '@std/cli';
import { loadConfig, validateConfig } from './config.ts';
import {
  addErrorRecord,
  addTranscodeRecord,
  getDatabaseStats,
  loadDatabase,
  saveDatabase,
  saveErrorLog,
} from './database.ts';
import { scanMediaDirectories, summarizeByType } from './scanner.ts';
import { estimateTranscodeTime, transcodeFile } from './transcoder.ts';
import {
  acquireLock,
  checkDependencies,
  releaseLock,
  runWithConcurrency,
  setupSignalHandlers,
} from './process.ts';
import { createLogger, type LogLevel, setGlobalLogger } from './logger.ts';
import { formatDuration, formatFileSize } from './ffprobe.ts';
import type { Config, MediaFile, TranscodeStats } from './types.ts';

const VERSION = '1.0.0';

/** CLI argument definition */
interface CliArgs {
  help: boolean;
  version: boolean;
  config?: string;
  'dry-run': boolean;
  verbose: boolean;
  quiet: boolean;
  'clear-errors': boolean;
  'list-errors': boolean;
  'media-dirs'?: string;
  concurrency?: number;
}

function printHelp(): void {
  console.log(`
danger-transcode v${VERSION}
Hardware-accelerated media transcoding for Rockchip devices

USAGE:
  deno task start [OPTIONS]

OPTIONS:
  -h, --help           Show this help message
  -v, --version        Show version
  -c, --config <path>  Path to configuration file
  -n, --dry-run        Simulate transcoding without making changes
  --verbose            Enable verbose output
  --quiet              Suppress non-error output
  --clear-errors       Clear error records and retry failed files
  --list-errors        List files that failed to transcode
  --media-dirs <dirs>  Comma-separated list of media directories
  --concurrency <n>    Number of concurrent transcodes (default: 1)

ENVIRONMENT VARIABLES:
  TRANSCODE_MEDIA_DIRS     Comma-separated list of media directories
  TRANSCODE_TEMP_DIR       Temporary directory for transcoding
  TRANSCODE_DB_PATH        Path to database file
  TRANSCODE_CONCURRENCY    Number of concurrent transcodes
  TRANSCODE_TV_MAX_HEIGHT  Max height for TV shows (default: 720)
  TRANSCODE_MOVIE_MAX_HEIGHT Max height for movies (default: 1080)
  FFMPEG_PATH              Path to ffmpeg binary
  FFPROBE_PATH             Path to ffprobe binary
  TRANSCODE_HW_ACCEL       Enable hardware acceleration (default: true)
  TRANSCODE_DRY_RUN        Enable dry run mode

EXAMPLES:
  # Run with default settings
  deno task start

  # Scan specific directories
  deno task start --media-dirs /mnt/media,/mnt/overflow

  # Dry run to see what would be transcoded
  deno task start --dry-run --verbose

  # Run with custom config file
  deno task start --config /etc/danger-transcode.json
`);
}

function printVersion(): void {
  console.log(`danger-transcode v${VERSION}`);
}

async function main(): Promise<void> {
  // Parse CLI arguments
  const args = parseArgs(Deno.args, {
    boolean: ['help', 'version', 'dry-run', 'verbose', 'quiet', 'clear-errors', 'list-errors'],
    string: ['config', 'media-dirs'],
    alias: { h: 'help', v: 'version', c: 'config', n: 'dry-run' },
    default: { help: false, version: false, 'dry-run': false, verbose: false, quiet: false },
  }) as unknown as CliArgs;

  if (args.help) {
    printHelp();
    Deno.exit(0);
  }

  if (args.version) {
    printVersion();
    Deno.exit(0);
  }

  // Setup logger
  const logLevel: LogLevel = args.quiet ? 'error' : args.verbose ? 'debug' : 'info';
  const logger = createLogger({ level: logLevel });
  setGlobalLogger(logger);

  logger.info(`danger-transcode v${VERSION} starting...`);

  // Load configuration
  let config: Config;
  try {
    config = await loadConfig(args.config);

    // CLI overrides
    if (args['media-dirs']) {
      config.mediaDirs = args['media-dirs'].split(',').map((d) => d.trim());
    }
    if (args.concurrency !== undefined) {
      config.maxConcurrency = args.concurrency;
    }
    if (args['dry-run']) {
      config.dryRun = true;
    }

    // Validate config
    const errors = validateConfig(config);
    if (errors.length > 0) {
      for (const error of errors) {
        logger.error(`Config error: ${error}`);
      }
      Deno.exit(1);
    }
  } catch (error) {
    logger.error('Failed to load configuration:', error);
    Deno.exit(1);
  }

  // Check dependencies
  const deps = await checkDependencies(config);
  if (!deps.ffmpeg) {
    logger.error(`ffmpeg not found at: ${config.ffmpegPath}`);
    Deno.exit(1);
  }
  if (!deps.ffprobe) {
    logger.error(`ffprobe not found at: ${config.ffprobePath}`);
    Deno.exit(1);
  }

  logger.debug('Configuration loaded:', config);

  // Acquire lock (singleton execution)
  if (!await acquireLock(config)) {
    logger.error('Another instance is already running');
    Deno.exit(1);
  }

  // Setup cleanup handler
  let isShuttingDown = false;
  const cleanup = (): Promise<void> => {
    if (isShuttingDown) return Promise.resolve();
    isShuttingDown = true;
    logger.info('Cleaning up...');
    return Promise.resolve();
  };
  setupSignalHandlers(config, cleanup);

  try {
    // Load database
    const db = await loadDatabase(config);

    // Handle special commands
    if (args['list-errors']) {
      const errorCount = Object.keys(db.errors).length;
      if (errorCount === 0) {
        logger.info('No error records found');
      } else {
        logger.info(`Found ${errorCount} error records:`);
        for (const [path, error] of Object.entries(db.errors)) {
          console.log(`  ${path}`);
          console.log(`    Error: ${error.error}`);
          console.log(`    Attempts: ${error.attempts}`);
        }
      }
      await releaseLock(config);
      Deno.exit(0);
    }

    if (args['clear-errors']) {
      const cleared = Object.keys(db.errors).length;
      db.errors = {};
      await saveDatabase(config, db);
      logger.info(`Cleared ${cleared} error records`);
      await releaseLock(config);
      Deno.exit(0);
    }

    // Show current stats
    const stats = getDatabaseStats(db);
    logger.info(
      `Database: ${stats.totalRecords} transcoded, ${stats.totalErrors} errors, ${
        formatFileSize(stats.totalSpaceSaved)
      } saved`,
    );

    // Scan media directories
    logger.info('Scanning media directories...');
    const scanResult = await scanMediaDirectories(config, db);

    if (scanResult.toTranscode.length === 0) {
      logger.info('No files need transcoding');
      await releaseLock(config);
      Deno.exit(0);
    }

    // Sort by file size (largest first)
    scanResult.toTranscode.sort((a, b) => b.size - a.size);

    // Show summary
    const typeSummary = summarizeByType(scanResult.toTranscode);
    logger.info(`Files to transcode: ${scanResult.toTranscode.length}`);
    logger.info(`  TV shows: ${typeSummary.tv}`);
    logger.info(`  Movies: ${typeSummary.movie}`);
    logger.info(`  Other: ${typeSummary.other}`);

    // Estimate total time
    const totalEstimate = scanResult.toTranscode.reduce((sum, file) => {
      return sum +
        estimateTranscodeTime(
          file.duration ?? 0,
          file.targetHeight ?? file.height,
          config.useHardwareAccel,
        );
    }, 0);
    logger.info(`Estimated time: ${formatDuration(totalEstimate)}`);

    if (config.dryRun) {
      console.log('\n' + '='.repeat(60));
      console.log('DRY RUN - No changes will be made');
      console.log('='.repeat(60));

      // Show files to transcode first (already sorted by size, largest first)
      const totalSize = scanResult.toTranscode.reduce((sum, f) => sum + f.size, 0);
      console.log(
        `\n⚡ WILL TRANSCODE (${scanResult.toTranscode.length} files, ${
          formatFileSize(totalSize)
        } total):`,
      );
      for (const file of scanResult.toTranscode) {
        const action =
          file.codec.toLowerCase().includes('hevc') || file.codec.toLowerCase().includes('h265')
            ? 'scale'
            : 'convert';
        console.log(
          `  → ${
            formatFileSize(file.size).padStart(10)
          } | ${file.path} [${file.codec} ${file.width}x${file.height} → HEVC ${file.targetWidth}x${file.targetHeight}, ${action}]`,
        );
      }

      // Show skipped files (already HEVC at target resolution, etc.)
      if (scanResult.skipped.length > 0) {
        console.log(`\n✓ SKIPPED (${scanResult.skipped.length} files):`);
        for (const { path, reason } of scanResult.skipped.slice(0, 50)) {
          console.log(`  ✓ ${path} [${reason}]`);
        }
        if (scanResult.skipped.length > 50) {
          console.log(`  ... and ${scanResult.skipped.length - 50} more`);
        }
      }

      // Show excluded files
      if (scanResult.excluded.length > 0) {
        console.log(`\n⊘ EXCLUDED (${scanResult.excluded.length} files):`);
        for (const { path, reason } of scanResult.excluded.slice(0, 50)) {
          console.log(`  ⊘ ${path} [${reason}]`);
        }
        if (scanResult.excluded.length > 50) {
          console.log(`  ... and ${scanResult.excluded.length - 50} more`);
        }
      }

      // Summary
      console.log('\n' + '='.repeat(60));
      console.log('SUMMARY:');
      console.log(`  To transcode: ${scanResult.toTranscode.length}`);
      console.log(`  Skipped:      ${scanResult.skipped.length}`);
      console.log(`  Excluded:     ${scanResult.excluded.length}`);
      console.log('='.repeat(60) + '\n');

      await releaseLock(config);
      Deno.exit(0);
    }

    // Transcode files
    const transcodeStats: TranscodeStats = {
      totalFiles: scanResult.toTranscode.length,
      skipped: 0,
      transcoded: 0,
      failed: 0,
      spaceSaved: 0,
      totalDuration: 0,
    };

    logger.info(`Starting transcode with concurrency: ${config.maxConcurrency}`);

    const processFile = async (file: MediaFile, index: number): Promise<void> => {
      logger.progress(index + 1, scanResult.toTranscode.length, file.path);

      const result = await transcodeFile(file, config);

      if (result.success && result.record) {
        addTranscodeRecord(db, result.record);
        transcodeStats.transcoded++;
        transcodeStats.spaceSaved += result.record.originalSize - result.record.newSize;
        transcodeStats.totalDuration += result.record.duration;
      } else {
        addErrorRecord(db, file.path, result.error ?? 'Unknown error');
        transcodeStats.failed++;
      }

      // Save database periodically
      if ((index + 1) % 5 === 0) {
        await saveDatabase(config, db);
      }
    };

    await runWithConcurrency(scanResult.toTranscode, config.maxConcurrency, processFile);
    logger.progressEnd();

    // Final save
    await saveDatabase(config, db);
    await saveErrorLog(config, db);

    // Print summary
    logger.info('='.repeat(50));
    logger.info('Transcoding complete!');
    logger.info(`  Transcoded: ${transcodeStats.transcoded}`);
    logger.info(`  Failed: ${transcodeStats.failed}`);
    logger.info(`  Space saved: ${formatFileSize(transcodeStats.spaceSaved)}`);
    logger.info(`  Total time: ${formatDuration(transcodeStats.totalDuration)}`);

    if (transcodeStats.failed > 0) {
      logger.warn(`${transcodeStats.failed} files failed. Run with --list-errors to see details.`);
    }
  } catch (error) {
    logger.error('Fatal error:', error);
    await releaseLock(config);
    Deno.exit(1);
  }

  await releaseLock(config);
}

// Run main
if (import.meta.main) {
  main();
}

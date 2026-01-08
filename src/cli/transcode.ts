/**
 * Transcode CLI Action
 * Handles the transcode subcommand for in-place media conversion
 */

import { loadConfig, validateConfig } from '../transcode/config.ts';
import {
  addErrorRecord,
  addTranscodeRecord,
  getDatabaseStats,
  loadDatabase,
  saveDatabase,
  saveErrorLog,
} from '../transcode/database.ts';
import { scanMediaDirectories, summarizeByType } from '../transcode/scanner.ts';
import { estimateTranscodeTime, transcodeFile } from '../transcode/transcoder.ts';
import {
  acquireLock,
  checkDependencies,
  releaseLock,
  runWithConcurrency,
  setupSignalHandlers,
} from '../transcode/process.ts';
import { createLogger, type LogLevel, setGlobalLogger } from '../shared/logger.ts';
import { formatDuration, formatBytes as formatFileSize } from '../shared/format.ts';
import type { Config, MediaFile, TranscodeStats } from '../transcode/types.ts';

/** Options for the transcode command */
export interface TranscodeOptions {
  config?: string;
  dryRun?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  logLevel?: string;
  mediaDirs?: string;
  concurrency?: number;
  clearErrors?: boolean;
  listErrors?: boolean;
}

/** Transcode action handler */
export async function transcodeAction(options: TranscodeOptions): Promise<void> {
  // Setup logger
  const logLevel: LogLevel = options.quiet ? 'error' : options.verbose ? 'debug' : ((options.logLevel as LogLevel) || 'info');
  const logger = createLogger({ level: logLevel });
  setGlobalLogger(logger);

  logger.info('danger-transcode starting...');

  // Load configuration
  let config: Config;
  try {
    config = await loadConfig(options.config);

    // CLI overrides
    if (options.mediaDirs) {
      config.mediaDirs = options.mediaDirs.split(',').map((d) => d.trim());
    }
    if (options.concurrency !== undefined) {
      config.maxConcurrency = options.concurrency;
    }
    if (options.dryRun) {
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
    if (options.listErrors) {
      await handleListErrors(db, logger, config);
      return;
    }

    if (options.clearErrors) {
      await handleClearErrors(db, logger, config);
      return;
    }

    // Run main transcode workflow
    await runTranscodeWorkflow(config, db, logger);
  } catch (error) {
    logger.error('Fatal error:', error);
    await releaseLock(config);
    Deno.exit(1);
  }

  await releaseLock(config);
}

/** Handle --list-errors flag */
async function handleListErrors(
  db: Awaited<ReturnType<typeof loadDatabase>>,
  logger: ReturnType<typeof createLogger>,
  config: Config
): Promise<void> {
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
}

/** Handle --clear-errors flag */
async function handleClearErrors(
  db: Awaited<ReturnType<typeof loadDatabase>>,
  logger: ReturnType<typeof createLogger>,
  config: Config
): Promise<void> {
  const cleared = Object.keys(db.errors).length;
  db.errors = {};
  await saveDatabase(config, db);
  logger.info(`Cleared ${cleared} error records`);
  await releaseLock(config);
}

/** Main transcode workflow */
async function runTranscodeWorkflow(
  config: Config,
  db: Awaited<ReturnType<typeof loadDatabase>>,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  // Show current stats
  const stats = getDatabaseStats(db);
  logger.info(
    `Database: ${stats.totalRecords} transcoded, ${stats.totalErrors} errors, ${formatFileSize(stats.totalSpaceSaved)} saved`
  );

  // Scan media directories
  logger.info('Scanning media directories...');
  const scanResult = await scanMediaDirectories(config, db);

  if (scanResult.toTranscode.length === 0) {
    logger.info('No files need transcoding');
    await releaseLock(config);
    return;
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
    return sum + estimateTranscodeTime(file.duration ?? 0, file.targetHeight ?? file.height, config.useHardwareAccel);
  }, 0);
  logger.info(`Estimated time: ${formatDuration(totalEstimate)}`);

  if (config.dryRun) {
    printDryRunSummary(scanResult, logger);
    await releaseLock(config);
    return;
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
}

/** Print dry run summary */
function printDryRunSummary(
  scanResult: Awaited<ReturnType<typeof scanMediaDirectories>>,
  logger: ReturnType<typeof createLogger>
): void {
  console.log('\n' + '='.repeat(60));
  console.log('DRY RUN - No changes will be made');
  console.log('='.repeat(60));

  const totalSize = scanResult.toTranscode.reduce((sum, f) => sum + f.size, 0);
  console.log(`\n⚡ WILL TRANSCODE (${scanResult.toTranscode.length} files, ${formatFileSize(totalSize)} total):`);

  for (const file of scanResult.toTranscode) {
    const action = file.codec.toLowerCase().includes('hevc') || file.codec.toLowerCase().includes('h265')
      ? 'scale'
      : 'convert';
    console.log(
      `  → ${formatFileSize(file.size).padStart(10)} | ${file.path} [${file.codec} ${file.width}x${file.height} → HEVC ${file.targetWidth}x${file.targetHeight}, ${action}]`
    );
  }

  if (scanResult.skipped.length > 0) {
    console.log(`\n✓ SKIPPED (${scanResult.skipped.length} files):`);
    for (const { path, reason } of scanResult.skipped.slice(0, 50)) {
      console.log(`  ✓ ${path} [${reason}]`);
    }
    if (scanResult.skipped.length > 50) {
      console.log(`  ... and ${scanResult.skipped.length - 50} more`);
    }
  }

  if (scanResult.excluded.length > 0) {
    console.log(`\n⊘ EXCLUDED (${scanResult.excluded.length} files):`);
    for (const { path, reason } of scanResult.excluded.slice(0, 50)) {
      console.log(`  ⊘ ${path} [${reason}]`);
    }
    if (scanResult.excluded.length > 50) {
      console.log(`  ... and ${scanResult.excluded.length - 50} more`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY:');
  console.log(`  To transcode: ${scanResult.toTranscode.length}`);
  console.log(`  Skipped:      ${scanResult.skipped.length}`);
  console.log(`  Excluded:     ${scanResult.excluded.length}`);
  console.log('='.repeat(60) + '\n');
}


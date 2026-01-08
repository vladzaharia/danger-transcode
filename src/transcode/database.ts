/**
 * Database module for danger-transcode
 * JSON-based tracking of transcoded files
 */

import { dirname } from '@std/path';
import { ensureDir } from '@std/fs';
import type { Config, ErrorRecord, TranscodeDatabase, TranscodeRecord } from './types.ts';
import { getLogger } from './logger.ts';

const logger = getLogger().child('database');

const DATABASE_VERSION = 1;

/**
 * Create an empty database structure
 */
function createEmptyDatabase(): TranscodeDatabase {
  return {
    version: DATABASE_VERSION,
    lastRun: new Date().toISOString(),
    records: {},
    errors: {},
  };
}

/**
 * Load the transcoding database from disk
 */
export async function loadDatabase(config: Config): Promise<TranscodeDatabase> {
  try {
    const content = await Deno.readTextFile(config.databasePath);
    const db = JSON.parse(content) as TranscodeDatabase;

    // Migrate if needed
    if (db.version !== DATABASE_VERSION) {
      logger.warn(`Database version mismatch (${db.version} vs ${DATABASE_VERSION}), migrating...`);
      db.version = DATABASE_VERSION;
    }

    logger.info(`Loaded database with ${Object.keys(db.records).length} records`);
    return db;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      logger.info('No existing database found, creating new one');
      return createEmptyDatabase();
    }
    throw error;
  }
}

/**
 * Save the transcoding database to disk
 */
export async function saveDatabase(config: Config, db: TranscodeDatabase): Promise<void> {
  // Ensure directory exists
  await ensureDir(dirname(config.databasePath));

  db.lastRun = new Date().toISOString();

  const content = JSON.stringify(db, null, 2);
  await Deno.writeTextFile(config.databasePath, content);

  logger.debug(`Saved database with ${Object.keys(db.records).length} records`);
}

/**
 * Check if a file has already been transcoded
 */
export function isFileTranscoded(db: TranscodeDatabase, filePath: string): boolean {
  return filePath in db.records && db.records[filePath].success;
}

/**
 * Check if a file has previous errors
 */
export function getFileErrors(db: TranscodeDatabase, filePath: string): ErrorRecord | null {
  return db.errors[filePath] ?? null;
}

/**
 * Add a successful transcode record
 */
export function addTranscodeRecord(
  db: TranscodeDatabase,
  record: TranscodeRecord,
): void {
  db.records[record.originalPath] = record;

  // Clear any previous errors
  if (record.originalPath in db.errors) {
    delete db.errors[record.originalPath];
  }

  logger.debug(`Added transcode record for: ${record.originalPath}`);
}

/**
 * Add an error record for a failed transcode
 */
export function addErrorRecord(
  db: TranscodeDatabase,
  filePath: string,
  error: string,
): void {
  const existingError = db.errors[filePath];

  if (existingError) {
    existingError.attempts += 1;
    existingError.timestamp = new Date().toISOString();
    existingError.error = error;
  } else {
    db.errors[filePath] = {
      path: filePath,
      timestamp: new Date().toISOString(),
      error,
      attempts: 1,
    };
  }

  logger.warn(`Added error record for: ${filePath} (${error})`);
}

/**
 * Get statistics from the database
 */
export function getDatabaseStats(db: TranscodeDatabase): {
  totalRecords: number;
  totalErrors: number;
  totalSpaceSaved: number;
} {
  const records = Object.values(db.records);

  const totalSpaceSaved = records.reduce((sum, record) => {
    if (record.success) {
      return sum + (record.originalSize - record.newSize);
    }
    return sum;
  }, 0);

  return {
    totalRecords: records.filter((r) => r.success).length,
    totalErrors: Object.keys(db.errors).length,
    totalSpaceSaved,
  };
}

/**
 * Load error records from the error log file
 */
export async function loadErrorLog(config: Config): Promise<ErrorRecord[]> {
  try {
    const content = await Deno.readTextFile(config.errorLogPath);
    return JSON.parse(content) as ErrorRecord[];
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }
}

/**
 * Save error records to the error log file
 */
export async function saveErrorLog(config: Config, db: TranscodeDatabase): Promise<void> {
  await ensureDir(dirname(config.errorLogPath));

  const errors = Object.values(db.errors);
  const content = JSON.stringify(errors, null, 2);
  await Deno.writeTextFile(config.errorLogPath, content);

  if (errors.length > 0) {
    logger.info(`Saved ${errors.length} error records to ${config.errorLogPath}`);
  }
}

/**
 * Clear all error records for retrying
 */
export function clearErrors(db: TranscodeDatabase): number {
  const count = Object.keys(db.errors).length;
  db.errors = {};
  return count;
}

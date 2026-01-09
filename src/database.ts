/**
 * Database module for danger-transcode
 * JSON-based tracking of transcoded files and analysis cache
 */

import { dirname } from '@std/path';
import { ensureDir } from '@std/fs';
import type { Config, ErrorRecord, TranscodeDatabase, TranscodeRecord } from './types.ts';
import type { AnalysisDatabase, AnalysisRecord } from './schemas.ts';
import { getLogger } from './logger.ts';

const logger = getLogger().child('database');

const DATABASE_VERSION = 1;
const ANALYSIS_VERSION = 1;

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

//═══════════════════════════════════════════════════════════════════════════════
// ANALYSIS DATABASE - Cache for ffprobe results
//═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an empty analysis database structure
 */
function createEmptyAnalysisDatabase(): AnalysisDatabase {
  return {
    version: ANALYSIS_VERSION,
    lastUpdated: new Date().toISOString(),
    records: {},
  };
}

/**
 * Load the analysis database from disk
 */
export async function loadAnalysisDatabase(config: Config): Promise<AnalysisDatabase> {
  try {
    const content = await Deno.readTextFile(config.analysisPath);
    const db = JSON.parse(content) as AnalysisDatabase;

    // Migrate if needed
    if (db.version !== ANALYSIS_VERSION) {
      logger.warn(`Analysis database version mismatch (${db.version} vs ${ANALYSIS_VERSION}), recreating...`);
      return createEmptyAnalysisDatabase();
    }

    logger.info(`Loaded analysis cache with ${Object.keys(db.records).length} records`);
    return db;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      logger.info('No existing analysis cache found, creating new one');
      return createEmptyAnalysisDatabase();
    }
    throw error;
  }
}

/**
 * Save the analysis database to disk
 */
export async function saveAnalysisDatabase(config: Config, db: AnalysisDatabase): Promise<void> {
  // Ensure directory exists
  await ensureDir(dirname(config.analysisPath));

  db.lastUpdated = new Date().toISOString();

  const content = JSON.stringify(db, null, 2);
  await Deno.writeTextFile(config.analysisPath, content);

  logger.debug(`Saved analysis cache with ${Object.keys(db.records).length} records`);
}

/**
 * Compute a quick "hash" for cache validation based on file size and mtime
 * Returns { size, mtime } tuple that can be compared
 */
export async function getFileIdentifier(filePath: string): Promise<{ size: number; mtime: string } | null> {
  try {
    const stat = await Deno.stat(filePath);
    return {
      size: stat.size,
      mtime: stat.mtime?.toISOString() ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Check if a cached analysis is still valid
 * Compares file size and mtime to detect changes
 */
export function isAnalysisCacheValid(
  record: AnalysisRecord,
  currentSize: number,
  currentMtime: string,
): boolean {
  return record.fileSize === currentSize && record.fileMtime === currentMtime;
}

/**
 * Get cached analysis for a file if valid
 * Returns null if not cached or cache is stale
 */
export async function getCachedAnalysis(
  db: AnalysisDatabase,
  filePath: string,
): Promise<AnalysisRecord | null> {
  const record = db.records[filePath];
  if (!record) {
    return null;
  }

  // Check if file has changed
  const fileId = await getFileIdentifier(filePath);
  if (!fileId) {
    return null;
  }

  if (isAnalysisCacheValid(record, fileId.size, fileId.mtime)) {
    return record;
  }

  // Cache is stale
  logger.debug(`Analysis cache stale for: ${filePath}`);
  return null;
}

/**
 * Add or update an analysis record in the cache
 */
export function setAnalysisRecord(
  db: AnalysisDatabase,
  record: AnalysisRecord,
): void {
  db.records[record.path] = record;
}

/**
 * Remove an analysis record (e.g., when file is deleted)
 */
export function removeAnalysisRecord(
  db: AnalysisDatabase,
  filePath: string,
): boolean {
  if (filePath in db.records) {
    delete db.records[filePath];
    return true;
  }
  return false;
}

/**
 * Get statistics from the analysis database
 */
export function getAnalysisStats(db: AnalysisDatabase): {
  totalRecords: number;
  lastUpdated: string;
} {
  return {
    totalRecords: Object.keys(db.records).length,
    lastUpdated: db.lastUpdated,
  };
}

/**
 * Unified configuration system for danger-transcode
 * Supports both new unified config format and legacy separate configs
 */

import { join, dirname } from '@std/path';
import { ensureDir } from '@std/fs';
import {
  VIDEO_EXTENSIONS,
  DEFAULT_EXCLUSION_DIRS,
  DEFAULT_EXCLUSION_PATTERNS,
  DEFAULT_PATHS,
} from './constants.ts';
import type {
  UnifiedConfig,
  SharedConfig,
  TranscodeModuleConfig,
  SyncModuleConfig,
  BitrateConfig,
  LegacyTranscodeConfig,
  LegacySyncConfig,
} from './types.ts';
import { getLogger } from './logger.ts';

const logger = getLogger().child('config');

//═══════════════════════════════════════════════════════════════════════════════
// DEFAULT CONFIGURATIONS
//═══════════════════════════════════════════════════════════════════════════════

/** Default shared configuration */
export const DEFAULT_SHARED_CONFIG: SharedConfig = {
  mediaDirs: ['/mnt/media', '/mnt/overflow'],
  tempDir: DEFAULT_PATHS.tempDir,
  maxConcurrency: 1,
  dryRun: false,
  videoExtensions: [...VIDEO_EXTENSIONS],
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
};

/** Default transcode module configuration */
export const DEFAULT_TRANSCODE_CONFIG: TranscodeModuleConfig = {
  databasePath: join(DEFAULT_PATHS.dataDir, DEFAULT_PATHS.databaseFile),
  errorLogPath: join(DEFAULT_PATHS.dataDir, DEFAULT_PATHS.errorLogFile),
  lockFilePath: join('/tmp', DEFAULT_PATHS.lockFile),
  tvMaxHeight: 720,
  movieMaxHeight: 1080,
  bitrates: { low: '2M', medium: '5M', high: '15M' },
  exclusions: {
    directories: [...DEFAULT_EXCLUSION_DIRS],
    pathPatterns: [],
    filePatterns: [...DEFAULT_EXCLUSION_PATTERNS],
    pathContains: [],
  },
  useHardwareAccel: true,
};

/** Default sync module configuration */
export const DEFAULT_SYNC_CONFIG: SyncModuleConfig = {
  destinations: [],
  tmdbApiKey: '',
  selection: {
    latestTvSeasons: true,
    popularMovies: { enabled: true, limit: 50 },
    trendingMovies: { enabled: true, timeWindow: 'week', limit: 30 },
    topRatedMovies: { enabled: true, limit: 50 },
    oscarWinners: { enabled: true, years: 2 },
    franchises: [],
    tmdbLists: [],
    tmdbCollections: [],
  },
  genreDistribution: { enabled: true, minPerGenre: 3 },
  syncDatabasePath: join(DEFAULT_PATHS.dataDir, DEFAULT_PATHS.syncDatabaseFile),
  downloadMissingMetadata: true,
};

/** Default unified configuration */
export const DEFAULT_UNIFIED_CONFIG: UnifiedConfig = {
  shared: DEFAULT_SHARED_CONFIG,
  transcode: DEFAULT_TRANSCODE_CONFIG,
  sync: DEFAULT_SYNC_CONFIG,
};

//═══════════════════════════════════════════════════════════════════════════════
// CONFIG FILE DISCOVERY
//═══════════════════════════════════════════════════════════════════════════════

/** Get default config file paths to check */
export function getDefaultConfigPaths(): string[] {
  const paths: string[] = [];
  const xdgConfig = Deno.env.get('XDG_CONFIG_HOME');
  const home = Deno.env.get('HOME');

  // Check for unified config first
  if (xdgConfig) {
    paths.push(join(xdgConfig, 'danger-transcode', 'config.json'));
  }
  if (home) {
    paths.push(join(home, '.config', 'danger-transcode', 'config.json'));
    paths.push(join(home, '.danger-transcode.json'));
  }
  paths.push('/etc/danger-transcode/config.json');
  paths.push('/etc/danger-transcode.json');

  return paths;
}

/** Check if a file exists */
async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Find the first existing config file */
export async function findConfigFile(): Promise<string | undefined> {
  // Check environment variable first
  const envPath = Deno.env.get('DANGER_TRANSCODE_CONFIG');
  if (envPath && (await fileExists(envPath))) {
    return envPath;
  }

  // Check default paths
  for (const path of getDefaultConfigPaths()) {
    if (await fileExists(path)) {
      return path;
    }
  }
  return undefined;
}

//═══════════════════════════════════════════════════════════════════════════════
// CONFIG LOADING
//═══════════════════════════════════════════════════════════════════════════════

/** Load raw JSON config from file */
async function loadJsonConfig(filePath: string): Promise<Record<string, unknown>> {
  try {
    const content = await Deno.readTextFile(filePath);
    return JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`Config file not found: ${filePath}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${filePath}\n${error.message}`);
    }
    throw error;
  }
}

/** Check if config is unified format (has 'shared' section) */
function isUnifiedConfig(config: Record<string, unknown>): boolean {
  return 'shared' in config && typeof config.shared === 'object';
}

/** Check if config is legacy transcode format */
function isLegacyTranscodeConfig(config: Record<string, unknown>): boolean {
  return 'mediaDirs' in config && 'bitrates' in config && !('shared' in config);
}

/** Check if config is legacy sync format */
function isLegacySyncConfig(config: Record<string, unknown>): boolean {
  return 'sourceMediaDirs' in config && 'destinations' in config && !('shared' in config);
}

/** Parse unified config from JSON */
function parseUnifiedConfig(raw: Record<string, unknown>): UnifiedConfig {
  const config = structuredClone(DEFAULT_UNIFIED_CONFIG);

  if (raw.shared && typeof raw.shared === 'object') {
    Object.assign(config.shared, raw.shared);
  }
  if (raw.transcode && typeof raw.transcode === 'object') {
    Object.assign(config.transcode, raw.transcode);
  }
  if (raw.sync && typeof raw.sync === 'object') {
    Object.assign(config.sync, raw.sync);
  }

  return config;
}

/** Convert legacy transcode config to unified format */
function convertLegacyTranscodeConfig(raw: Record<string, unknown>): UnifiedConfig {
  const config = structuredClone(DEFAULT_UNIFIED_CONFIG);
  const legacy = raw as unknown as LegacyTranscodeConfig;

  // Map to shared config
  if (legacy.mediaDirs) config.shared.mediaDirs = legacy.mediaDirs;
  if (legacy.tempDir) config.shared.tempDir = legacy.tempDir;
  if (legacy.maxConcurrency) config.shared.maxConcurrency = legacy.maxConcurrency;
  if (legacy.dryRun !== undefined) config.shared.dryRun = legacy.dryRun;
  if (legacy.videoExtensions) config.shared.videoExtensions = legacy.videoExtensions;
  if (legacy.ffmpegPath) config.shared.ffmpegPath = legacy.ffmpegPath;
  if (legacy.ffprobePath) config.shared.ffprobePath = legacy.ffprobePath;

  // Map to transcode config
  if (legacy.databasePath) config.transcode.databasePath = legacy.databasePath;
  if (legacy.errorLogPath) config.transcode.errorLogPath = legacy.errorLogPath;
  if (legacy.lockFilePath) config.transcode.lockFilePath = legacy.lockFilePath;
  if (legacy.tvMaxHeight) config.transcode.tvMaxHeight = legacy.tvMaxHeight;
  if (legacy.movieMaxHeight) config.transcode.movieMaxHeight = legacy.movieMaxHeight;
  if (legacy.bitrates) config.transcode.bitrates = legacy.bitrates;
  if (legacy.exclusions) config.transcode.exclusions = legacy.exclusions;
  if (legacy.useHardwareAccel !== undefined) config.transcode.useHardwareAccel = legacy.useHardwareAccel;

  return config;
}

/** Convert legacy sync config to unified format */
function convertLegacySyncConfig(raw: Record<string, unknown>): UnifiedConfig {
  const config = structuredClone(DEFAULT_UNIFIED_CONFIG);
  const legacy = raw as unknown as LegacySyncConfig;

  // Map to shared config
  if (legacy.sourceMediaDirs) config.shared.mediaDirs = legacy.sourceMediaDirs;
  if (legacy.tempDir) config.shared.tempDir = legacy.tempDir;
  if (legacy.maxConcurrency) config.shared.maxConcurrency = legacy.maxConcurrency;
  if (legacy.dryRun !== undefined) config.shared.dryRun = legacy.dryRun;

  // Map to sync config
  if (legacy.destinations) config.sync.destinations = legacy.destinations;
  if (legacy.tmdbApiKey) config.sync.tmdbApiKey = legacy.tmdbApiKey;
  if (legacy.tmdbReadAccessToken) config.sync.tmdbReadAccessToken = legacy.tmdbReadAccessToken;
  if (legacy.selection) config.sync.selection = legacy.selection;
  if (legacy.genreDistribution) config.sync.genreDistribution = legacy.genreDistribution;
  if (legacy.syncDatabasePath) config.sync.syncDatabasePath = legacy.syncDatabasePath;
  if (legacy.openSubtitlesApiKey) config.sync.openSubtitlesApiKey = legacy.openSubtitlesApiKey;
  if (legacy.downloadMissingMetadata !== undefined) {
    config.sync.downloadMissingMetadata = legacy.downloadMissingMetadata;
  }

  return config;
}

//═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
//═══════════════════════════════════════════════════════════════════════════════

/**
 * Load unified configuration from file
 * Supports both new unified format and legacy formats
 */
export async function loadUnifiedConfig(configFilePath?: string): Promise<UnifiedConfig> {
  // Find config file
  let actualPath = configFilePath;
  if (!actualPath) {
    actualPath = await findConfigFile();
  }

  if (!actualPath) {
    const searchedPaths = getDefaultConfigPaths();
    throw new Error(
      `No configuration file found. Create one at:\n` +
        `  ~/.config/danger-transcode/config.json\n\n` +
        `Or specify one with --config <path>\n\n` +
        `Searched locations:\n${searchedPaths.map((p) => `  - ${p}`).join('\n')}\n\n` +
        `See config.example.json for reference.`
    );
  }

  logger.info(`Loading config from: ${actualPath}`);
  const raw = await loadJsonConfig(actualPath);

  // Detect config format and convert
  let config: UnifiedConfig;
  if (isUnifiedConfig(raw)) {
    logger.debug('Detected unified config format');
    config = parseUnifiedConfig(raw);
  } else if (isLegacyTranscodeConfig(raw)) {
    logger.debug('Detected legacy transcode config format');
    config = convertLegacyTranscodeConfig(raw);
  } else if (isLegacySyncConfig(raw)) {
    logger.debug('Detected legacy sync config format');
    config = convertLegacySyncConfig(raw);
  } else {
    // Try to merge as unified config anyway
    logger.warn('Unknown config format, attempting to merge');
    config = parseUnifiedConfig(raw);
  }

  // Apply environment variable overrides
  config = applyEnvOverrides(config);

  return config;
}

/** Apply environment variable overrides to config */
function applyEnvOverrides(config: UnifiedConfig): UnifiedConfig {
  const env = Deno.env;

  // Shared overrides
  const mediaDirs = env.get('TRANSCODE_MEDIA_DIRS');
  if (mediaDirs) config.shared.mediaDirs = mediaDirs.split(',').map((d) => d.trim());

  const tempDir = env.get('TRANSCODE_TEMP_DIR');
  if (tempDir) config.shared.tempDir = tempDir;

  const concurrency = env.get('TRANSCODE_CONCURRENCY');
  if (concurrency) config.shared.maxConcurrency = parseInt(concurrency, 10) || 1;

  const dryRun = env.get('TRANSCODE_DRY_RUN');
  if (dryRun !== undefined) config.shared.dryRun = dryRun === 'true' || dryRun === '1';

  // FFmpeg paths
  const ffmpegPath = env.get('FFMPEG_PATH');
  if (ffmpegPath) config.shared.ffmpegPath = ffmpegPath;

  const ffprobePath = env.get('FFPROBE_PATH');
  if (ffprobePath) config.shared.ffprobePath = ffprobePath;

  // Transcode module overrides
  const dbPath = env.get('TRANSCODE_DB_PATH');
  if (dbPath) config.transcode.databasePath = dbPath;

  const errorPath = env.get('TRANSCODE_ERROR_PATH');
  if (errorPath) config.transcode.errorLogPath = errorPath;

  const tvMax = env.get('TRANSCODE_TV_MAX_HEIGHT');
  if (tvMax) config.transcode.tvMaxHeight = parseInt(tvMax, 10) || 720;

  const movieMax = env.get('TRANSCODE_MOVIE_MAX_HEIGHT');
  if (movieMax) config.transcode.movieMaxHeight = parseInt(movieMax, 10) || 1080;

  const hwAccel = env.get('TRANSCODE_HW_ACCEL');
  if (hwAccel !== undefined) config.transcode.useHardwareAccel = hwAccel !== 'false' && hwAccel !== '0';

  // Sync module overrides
  const tmdbKey = env.get('TMDB_API_KEY');
  if (tmdbKey) config.sync.tmdbApiKey = tmdbKey;

  const tmdbToken = env.get('TMDB_READ_ACCESS_TOKEN');
  if (tmdbToken) config.sync.tmdbReadAccessToken = tmdbToken;

  return config;
}

/**
 * Convert unified config to legacy transcode Config format
 * Used for backward compatibility with existing transcode module
 */
export function toLegacyTranscodeConfig(unified: UnifiedConfig): LegacyTranscodeConfig {
  return {
    mediaDirs: unified.shared.mediaDirs,
    tempDir: unified.shared.tempDir,
    databasePath: unified.transcode.databasePath,
    errorLogPath: unified.transcode.errorLogPath,
    lockFilePath: unified.transcode.lockFilePath,
    maxConcurrency: unified.shared.maxConcurrency,
    tvMaxHeight: unified.transcode.tvMaxHeight,
    movieMaxHeight: unified.transcode.movieMaxHeight,
    bitrates: unified.transcode.bitrates,
    videoExtensions: unified.shared.videoExtensions,
    exclusions: unified.transcode.exclusions,
    ffmpegPath: unified.shared.ffmpegPath,
    ffprobePath: unified.shared.ffprobePath,
    useHardwareAccel: unified.transcode.useHardwareAccel,
    dryRun: unified.shared.dryRun,
  };
}

/**
 * Convert unified config to legacy SyncConfig format
 * Used for backward compatibility with existing sync module
 */
export function toLegacySyncConfig(unified: UnifiedConfig): LegacySyncConfig {
  return {
    sourceMediaDirs: unified.shared.mediaDirs,
    destinations: unified.sync.destinations,
    tmdbApiKey: unified.sync.tmdbApiKey,
    tmdbReadAccessToken: unified.sync.tmdbReadAccessToken,
    selection: unified.sync.selection,
    genreDistribution: unified.sync.genreDistribution,
    tempDir: unified.shared.tempDir,
    syncDatabasePath: unified.sync.syncDatabasePath,
    openSubtitlesApiKey: unified.sync.openSubtitlesApiKey,
    downloadMissingMetadata: unified.sync.downloadMissingMetadata,
    maxConcurrency: unified.shared.maxConcurrency,
    dryRun: unified.shared.dryRun,
  };
}

//═══════════════════════════════════════════════════════════════════════════════
// VALIDATION
//═══════════════════════════════════════════════════════════════════════════════

/** Validate unified configuration */
export function validateUnifiedConfig(config: UnifiedConfig): string[] {
  const errors: string[] = [];

  // Shared validation
  if (config.shared.mediaDirs.length === 0) {
    errors.push('At least one media directory must be specified (shared.mediaDirs)');
  }
  if (config.shared.maxConcurrency < 1) {
    errors.push('maxConcurrency must be at least 1');
  }

  // Transcode validation
  if (config.transcode.tvMaxHeight < 240) {
    errors.push('tvMaxHeight must be at least 240');
  }
  if (config.transcode.movieMaxHeight < 240) {
    errors.push('movieMaxHeight must be at least 240');
  }

  return errors;
}

/** Validate config for sync operations (requires TMDB key) */
export function validateSyncConfig(config: UnifiedConfig): string[] {
  const errors = validateUnifiedConfig(config);

  if (!config.sync.tmdbApiKey) {
    errors.push('TMDB API key is required for sync operations (sync.tmdbApiKey)');
  }
  if (config.sync.destinations.length === 0) {
    errors.push('At least one destination drive must be configured (sync.destinations)');
  }

  return errors;
}

//═══════════════════════════════════════════════════════════════════════════════
// MODULE EXPORTS (for re-export in submodules)
//═══════════════════════════════════════════════════════════════════════════════

export type {
  UnifiedConfig,
  SharedConfig,
  TranscodeModuleConfig,
  SyncModuleConfig,
  BitrateConfig,
  LegacyTranscodeConfig,
  LegacySyncConfig,
} from './types.ts';


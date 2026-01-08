/**
 * Configuration module for danger-transcode
 * Bridges shared config with legacy Config type for backward compatibility
 */

import type { Config } from './types.ts';
import {
  loadUnifiedConfig,
  toLegacyTranscodeConfig,
  validateUnifiedConfig,
  getDefaultConfigPaths as sharedGetDefaultConfigPaths,
  DEFAULT_UNIFIED_CONFIG,
} from '../shared/config.ts';
import { VIDEO_EXTENSIONS, DEFAULT_EXCLUSION_DIRS, DEFAULT_EXCLUSION_PATTERNS } from '../shared/constants.ts';

/** Default configuration values (derived from shared defaults) */
export const DEFAULT_CONFIG: Config = toLegacyTranscodeConfig(DEFAULT_UNIFIED_CONFIG);

/**
 * Load configuration from environment variables
 * Environment variables override default config
 */
export function loadConfigFromEnv(baseConfig: Config = DEFAULT_CONFIG): Config {
  const config = { ...baseConfig };

  // Media directories (comma-separated)
  const mediaDirs = Deno.env.get('TRANSCODE_MEDIA_DIRS');
  if (mediaDirs) {
    config.mediaDirs = mediaDirs.split(',').map((d) => d.trim());
  }

  // Paths
  const tempDir = Deno.env.get('TRANSCODE_TEMP_DIR');
  if (tempDir) config.tempDir = tempDir;

  const dbPath = Deno.env.get('TRANSCODE_DB_PATH');
  if (dbPath) config.databasePath = dbPath;

  const errorPath = Deno.env.get('TRANSCODE_ERROR_PATH');
  if (errorPath) config.errorLogPath = errorPath;

  // Concurrency
  const concurrency = Deno.env.get('TRANSCODE_CONCURRENCY');
  if (concurrency) config.maxConcurrency = parseInt(concurrency, 10) || 1;

  // Resolution limits
  const tvMax = Deno.env.get('TRANSCODE_TV_MAX_HEIGHT');
  if (tvMax) config.tvMaxHeight = parseInt(tvMax, 10) || 720;

  const movieMax = Deno.env.get('TRANSCODE_MOVIE_MAX_HEIGHT');
  if (movieMax) config.movieMaxHeight = parseInt(movieMax, 10) || 1080;

  // FFmpeg paths
  const ffmpegPath = Deno.env.get('FFMPEG_PATH');
  if (ffmpegPath) config.ffmpegPath = ffmpegPath;

  const ffprobePath = Deno.env.get('FFPROBE_PATH');
  if (ffprobePath) config.ffprobePath = ffprobePath;

  // Hardware acceleration
  const hwAccel = Deno.env.get('TRANSCODE_HW_ACCEL');
  if (hwAccel !== undefined) config.useHardwareAccel = hwAccel !== 'false' && hwAccel !== '0';

  // Dry run
  const dryRun = Deno.env.get('TRANSCODE_DRY_RUN');
  if (dryRun !== undefined) config.dryRun = dryRun === 'true' || dryRun === '1';

  return config;
}

/**
 * Load configuration from a JSON file
 * @deprecated Use loadUnifiedConfig from shared/config.ts instead
 */
export async function loadConfigFromFile(filePath: string): Promise<Partial<Config>> {
  try {
    const content = await Deno.readTextFile(filePath);
    return JSON.parse(content) as Partial<Config>;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return {};
    }
    throw error;
  }
}

/**
 * Get default config file paths to check
 * @deprecated Use getDefaultConfigPaths from shared/config.ts instead
 */
function getDefaultConfigPaths(): string[] {
  return sharedGetDefaultConfigPaths();
}

/**
 * Load configuration using the unified config system
 * Supports both new unified format and legacy transcode-only format
 */
export async function loadConfig(configFilePath?: string): Promise<Config> {
  // Use unified config system - it handles both formats
  const unifiedConfig = await loadUnifiedConfig(configFilePath);
  return toLegacyTranscodeConfig(unifiedConfig);
}

/**
 * Validate configuration
 */
export function validateConfig(config: Config): string[] {
  const errors: string[] = [];

  if (config.mediaDirs.length === 0) {
    errors.push('At least one media directory must be specified');
  }

  if (config.maxConcurrency < 1) {
    errors.push('maxConcurrency must be at least 1');
  }

  if (config.tvMaxHeight < 240) {
    errors.push('tvMaxHeight must be at least 240');
  }

  if (config.movieMaxHeight < 240) {
    errors.push('movieMaxHeight must be at least 240');
  }

  return errors;
}

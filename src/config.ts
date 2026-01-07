/**
 * Configuration module for danger-transcode
 * Provides default configuration and loading from environment/file
 */

import type { Config } from './types.ts';

/** Default configuration values */
export const DEFAULT_CONFIG: Config = {
  // Media directories to scan
  mediaDirs: ['/mnt/media', '/mnt/overflow'],

  // Temporary directory for transcoding work
  tempDir: '/tmp/danger-transcode',

  // Database and log paths
  databasePath: '/var/lib/danger-transcode/database.json',
  errorLogPath: '/var/lib/danger-transcode/errors.json',
  lockFilePath: '/tmp/danger-transcode.lock',

  // Concurrency - RK3588 can handle 1-2 concurrent HEVC encodes
  maxConcurrency: 1,

  // Resolution limits (don't upscale, only downscale if above)
  tvMaxHeight: 720, // 720p for TV shows
  movieMaxHeight: 1080, // 1080p for movies

  // Bitrate settings for HEVC (VBR)
  bitrates: {
    low: '2M', // For 720p and below
    medium: '5M', // For 1080p
    high: '15M', // For 4K and above
  },

  // Video file extensions to process
  videoExtensions: [
    '.mkv',
    '.mp4',
    '.avi',
    '.mov',
    '.m4v',
    '.wmv',
    '.flv',
    '.webm',
    '.ts',
    '.m2ts',
    '.mpg',
    '.mpeg',
    '.vob',
    '.divx',
    '.3gp',
  ],

  // Exclusion rules - files/directories to skip
  exclusions: {
    // Directory names to exclude (case-insensitive)
    directories: [
      'karaoke',
      'singalong',
      'samples',
      'sample',
      'extras',
      'featurettes',
      'behind the scenes',
      'deleted scenes',
      'interviews',
      'trailers',
    ],
    // Regex patterns matched against full path
    pathPatterns: [],
    // Regex patterns matched against filename only
    filePatterns: [
      '-sample\\.', // sample files like movie-sample.mkv
      '\\bsample\\b', // word "sample" in filename
      '\\btrailer\\b', // trailers
    ],
    // Simple string contains check on path (case-insensitive)
    pathContains: [],
  },

  // FFmpeg/FFprobe paths (use system default)
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',

  // Hardware acceleration settings
  useHardwareAccel: true,

  // Dry run mode
  dryRun: false,
};

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
 * Merge configurations with priority: file > env > defaults
 */
export async function loadConfig(configFilePath?: string): Promise<Config> {
  let config = { ...DEFAULT_CONFIG };

  // Load from file if specified
  if (configFilePath) {
    const fileConfig = await loadConfigFromFile(configFilePath);
    config = { ...config, ...fileConfig };
  }

  // Override with environment variables
  config = loadConfigFromEnv(config);

  return config;
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

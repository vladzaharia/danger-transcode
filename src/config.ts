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
 * Get default config file paths to check
 */
function getDefaultConfigPaths(): string[] {
  const paths: string[] = [];

  // XDG config home
  const xdgConfig = Deno.env.get('XDG_CONFIG_HOME');
  if (xdgConfig) {
    paths.push(`${xdgConfig}/danger-transcode/config.json`);
  }

  // User home directory
  const home = Deno.env.get('HOME');
  if (home) {
    paths.push(`${home}/.config/danger-transcode/config.json`);
    paths.push(`${home}/.danger-transcode.json`);
  }

  // System-wide config
  paths.push('/etc/danger-transcode/config.json');
  paths.push('/etc/danger-transcode.json');

  return paths;
}

/**
 * Find the first existing config file from default locations
 */
async function findDefaultConfigFile(): Promise<string | undefined> {
  for (const path of getDefaultConfigPaths()) {
    try {
      await Deno.stat(path);
      return path;
    } catch {
      // File doesn't exist, try next
    }
  }
  return undefined;
}

/**
 * Merge configurations with priority: file > env > defaults
 * Throws an error if no config file is found
 */
export async function loadConfig(configFilePath?: string): Promise<Config> {
  // Determine which config file to use
  let actualConfigPath = configFilePath;
  if (!actualConfigPath) {
    actualConfigPath = await findDefaultConfigFile();
  }

  // Require a config file - don't use defaults blindly
  if (!actualConfigPath) {
    const searchedPaths = getDefaultConfigPaths();
    throw new Error(
      `No configuration file found. Create one at:\n` +
        `  ~/.config/danger-transcode/config.json\n\n` +
        `Or specify one with --config <path>\n\n` +
        `Searched locations:\n${searchedPaths.map((p) => `  - ${p}`).join('\n')}\n\n` +
        `See config.example.json for reference.`,
    );
  }

  // Start with defaults, then overlay file config
  let config = { ...DEFAULT_CONFIG };
  console.log(`Loading config from: ${actualConfigPath}`);
  const fileConfig = await loadConfigFromFile(actualConfigPath);
  config = { ...config, ...fileConfig };

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

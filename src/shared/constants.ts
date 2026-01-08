/**
 * Shared constants for danger-transcode
 * Centralized definitions used by both transcode and sync modules
 */

/** Video file extensions to process */
export const VIDEO_EXTENSIONS = [
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
] as const;

/** Video extensions as a Set for efficient lookup */
export const VIDEO_EXTENSIONS_SET = new Set(VIDEO_EXTENSIONS);

/** Default bitrate configurations by resolution (in bits per second) */
export const DEFAULT_BITRATES = {
  '4k': 15_000_000, // 15 Mbps for 4K
  '1080p': 8_000_000, // 8 Mbps for 1080p
  '720p': 4_000_000, // 4 Mbps for 720p
  '480p': 2_000_000, // 2 Mbps for 480p
  default: 6_000_000, // 6 Mbps default
} as const;

/** Audio bitrate estimate (stereo AAC) in bits per second */
export const DEFAULT_AUDIO_BITRATE = 192_000; // 192 kbps

/** Overhead factor for container and metadata */
export const CONTAINER_OVERHEAD_FACTOR = 1.05; // 5% overhead

/** Default exclusion directory names */
export const DEFAULT_EXCLUSION_DIRS = [
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
] as const;

/** Default exclusion file patterns (regex strings) */
export const DEFAULT_EXCLUSION_PATTERNS = [
  '-sample\\.', // sample files like movie-sample.mkv
  '\\bsample\\b', // word "sample" in filename
  '\\btrailer\\b', // trailers
] as const;

/** Default paths for configuration files */
export const DEFAULT_CONFIG_PATHS = {
  /** XDG config directory name */
  xdgDirName: 'danger-transcode',
  /** Config filename */
  configFile: 'config.json',
  /** Legacy config filename (in home) */
  legacyConfigFile: '.danger-transcode.json',
  /** System-wide config paths */
  systemPaths: ['/etc/danger-transcode/config.json', '/etc/danger-transcode.json'],
} as const;

/** Default database and temp directory paths */
export const DEFAULT_PATHS = {
  tempDir: '/tmp/danger-transcode',
  dataDir: '/var/lib/danger-transcode',
  databaseFile: 'database.json',
  errorLogFile: 'errors.json',
  lockFile: 'danger-transcode.lock',
  syncDatabaseFile: 'sync-database.json',
} as const;

/** Resolution presets */
export const RESOLUTION_PRESETS = {
  '4k': { width: 3840, height: 2160 },
  '1440p': { width: 2560, height: 1440 },
  '1080p': { width: 1920, height: 1080 },
  '720p': { width: 1280, height: 720 },
  '480p': { width: 854, height: 480 },
  '360p': { width: 640, height: 360 },
} as const;

/** HEVC codec names (for detection) */
export const HEVC_CODEC_NAMES = ['hevc', 'h265', 'x265', 'libx265'] as const;

/** TV show season folder pattern */
export const SEASON_FOLDER_PATTERN = /^Season\s*(\d{1,2})$/i;

/** TV episode filename patterns */
export const TV_EPISODE_PATTERNS = [
  /^(.+?)\s*-?\s*S(\d{1,2})E(\d{1,3})/i, // Show Name - S01E01
  /^(.+?)[\.\s]S(\d{1,2})E(\d{1,3})/i, // Show.Name.S01E01
  /^(.+?)[\.\s](\d{1,2})x(\d{1,3})/i, // Show Name 1x01
  /^(.+?)\s*-?\s*(\d{1,2})x(\d{1,3})/i, // Show Name - 01x01
] as const;

/** Movie filename patterns */
export const MOVIE_PATTERNS = [
  /^(.+?)[\.\s][\(\[]?(\d{4})[\)\]]?/, // Movie (2023) or Movie.2023
  /^(.+?)\s*-\s*(\d{4})/, // Movie - 2023
] as const;


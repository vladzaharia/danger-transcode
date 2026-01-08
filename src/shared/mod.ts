/**
 * Shared module for danger-transcode
 * Central exports for shared utilities, types, and configuration
 */

// Constants
export {
  VIDEO_EXTENSIONS,
  VIDEO_EXTENSIONS_SET,
  DEFAULT_BITRATES,
  DEFAULT_AUDIO_BITRATE,
  CONTAINER_OVERHEAD_FACTOR,
  DEFAULT_EXCLUSION_DIRS,
  DEFAULT_EXCLUSION_PATTERNS,
  DEFAULT_CONFIG_PATHS,
  DEFAULT_PATHS,
  RESOLUTION_PRESETS,
  HEVC_CODEC_NAMES,
  SEASON_FOLDER_PATTERN,
  TV_EPISODE_PATTERNS,
  MOVIE_PATTERNS,
} from './constants.ts';

// Formatting utilities
export {
  formatBytes,
  formatFileSize,
  formatDuration,
  formatBitrate,
  parseBitrateString,
  parseBytes,
  formatNumber,
  formatPercentage,
  formatTimestamp,
  truncate,
  pad,
} from './format.ts';

// Logger
export {
  Logger,
  getLogger,
  setGlobalLogger,
  createLogger,
  type LogLevel,
  type LoggerOptions,
} from './logger.ts';

// Process utilities
export {
  acquireLock,
  releaseLock,
  Semaphore,
  runWithConcurrency,
  setupSignalHandlers,
  checkCommand,
  checkFFmpegDependencies,
} from './process.ts';

// Configuration
export {
  DEFAULT_SHARED_CONFIG,
  DEFAULT_TRANSCODE_CONFIG,
  DEFAULT_SYNC_CONFIG,
  DEFAULT_UNIFIED_CONFIG,
  getDefaultConfigPaths,
  findConfigFile,
  loadUnifiedConfig,
  toLegacyTranscodeConfig,
  toLegacySyncConfig,
  validateUnifiedConfig,
  validateSyncConfig,
} from './config.ts';

// Types
export type {
  // Shared config types
  BitrateConfig,
  ExclusionRules,
  SharedConfig,
  TranscodeModuleConfig,
  SyncModuleConfig,
  UnifiedConfig,
  LegacyTranscodeConfig,
  LegacySyncConfig,
  // Sync config types
  DestinationDrive,
  PopularMoviesCriteria,
  TrendingMoviesCriteria,
  TopRatedMoviesCriteria,
  OscarWinnersCriteria,
  FranchiseConfig,
  GenreDistribution,
  SelectionConfig,
  // Common types
  MediaType,
  VideoExtension,
  ResolutionPreset,
  Resolution,
  BasicMediaInfo,
} from './types.ts';


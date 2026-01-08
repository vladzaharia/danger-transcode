/**
 * Logger module for danger-transcode
 * Re-exports from shared module for backward compatibility
 * @deprecated Import from '../shared/logger.ts' instead
 */

export {
  Logger,
  getLogger,
  setGlobalLogger,
  createLogger,
  type LogLevel,
  type LoggerOptions,
} from '../shared/logger.ts';

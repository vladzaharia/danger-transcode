/**
 * Process manager module for danger-transcode
 * Re-exports from shared module with backward-compatible wrappers
 * @deprecated Import from '../shared/process.ts' instead
 */

import type { Config } from './types.ts';
import {
  acquireLock as sharedAcquireLock,
  releaseLock as sharedReleaseLock,
  setupSignalHandlers as sharedSetupSignalHandlers,
  checkFFmpegDependencies,
} from '../shared/process.ts';

// Re-export common utilities directly
export {
  Semaphore,
  runWithConcurrency,
  checkCommand,
} from '../shared/process.ts';

/**
 * Acquire the process lock (backward-compatible wrapper)
 * @deprecated Use shared/process.ts acquireLock(lockFilePath) instead
 */
export async function acquireLock(config: Config): Promise<boolean> {
  return sharedAcquireLock(config.lockFilePath);
}

/**
 * Release the process lock (backward-compatible wrapper)
 * @deprecated Use shared/process.ts releaseLock(lockFilePath) instead
 */
export async function releaseLock(config: Config): Promise<void> {
  return sharedReleaseLock(config.lockFilePath);
}

/**
 * Setup signal handlers (backward-compatible wrapper)
 * @deprecated Use shared/process.ts setupSignalHandlers(lockFilePath, cleanup) instead
 */
export function setupSignalHandlers(config: Config, cleanup: () => Promise<void>): void {
  sharedSetupSignalHandlers(config.lockFilePath, cleanup);
}

/**
 * Check if ffmpeg and ffprobe are available (backward-compatible wrapper)
 * @deprecated Use shared/process.ts checkFFmpegDependencies instead
 */
export async function checkDependencies(
  config: Config
): Promise<{ ffmpeg: boolean; ffprobe: boolean }> {
  return checkFFmpegDependencies(config.ffmpegPath, config.ffprobePath);
}

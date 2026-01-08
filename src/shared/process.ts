/**
 * Process manager module for danger-transcode
 * Handles singleton execution, file locking, and concurrency control
 * Shared across all modules
 */

import { dirname } from '@std/path';
import { ensureDir } from '@std/fs';
import { getLogger } from './logger.ts';

const logger = getLogger().child('process');

/** Lock file handle */
let lockFile: Deno.FsFile | null = null;

/**
 * Acquire the process lock to ensure only one instance runs at a time
 * Returns true if lock acquired, false if another instance is running
 */
export async function acquireLock(lockFilePath: string): Promise<boolean> {
  try {
    // Ensure lock file directory exists
    await ensureDir(dirname(lockFilePath));

    // Try to create lock file exclusively
    lockFile = await Deno.open(lockFilePath, {
      write: true,
      create: true,
      truncate: true,
    });

    // Try to acquire an exclusive lock (non-blocking)
    try {
      await lockFile.lock(true); // exclusive lock
    } catch {
      // Lock failed - another instance is running
      lockFile.close();
      lockFile = null;
      return false;
    }

    // Write PID to lock file
    const pid = Deno.pid.toString();
    await lockFile.write(new TextEncoder().encode(pid));

    logger.debug(`Lock acquired (PID: ${pid})`);
    return true;
  } catch (error) {
    logger.error('Failed to acquire lock:', error);
    return false;
  }
}

/**
 * Release the process lock
 */
export async function releaseLock(lockFilePath: string): Promise<void> {
  if (lockFile) {
    try {
      await lockFile.unlock();
      lockFile.close();
      lockFile = null;

      // Remove lock file
      await Deno.remove(lockFilePath);
      logger.debug('Lock released');
    } catch (error) {
      logger.error('Failed to release lock:', error);
    }
  }
}

/**
 * Simple semaphore for concurrency control
 */
export class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    // Wait for a permit to become available
    return new Promise((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    const next = this.waitQueue.shift();
    if (next) {
      this.permits--;
      next();
    }
  }

  get available(): number {
    return this.permits;
  }
}

/**
 * Run tasks concurrently with a limit
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  maxConcurrency: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const semaphore = new Semaphore(maxConcurrency);
  const results: R[] = [];

  const tasks = items.map(async (item, index) => {
    await semaphore.acquire();
    try {
      const result = await task(item, index);
      results[index] = result;
      return result;
    } finally {
      semaphore.release();
    }
  });

  await Promise.all(tasks);
  return results;
}

/**
 * Setup signal handlers for graceful shutdown
 */
export function setupSignalHandlers(lockFilePath: string, cleanup: () => Promise<void>): void {
  const handleSignal = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await cleanup();
    await releaseLock(lockFilePath);
    Deno.exit(0);
  };

  // Handle SIGINT (Ctrl+C) and SIGTERM
  Deno.addSignalListener('SIGINT', () => handleSignal('SIGINT'));
  Deno.addSignalListener('SIGTERM', () => handleSignal('SIGTERM'));
}

/**
 * Check if a command is available in PATH
 */
export async function checkCommand(cmd: string): Promise<boolean> {
  try {
    const command = new Deno.Command(cmd, { args: ['-version'], stdout: 'null', stderr: 'null' });
    const { code } = await command.output();
    return code === 0;
  } catch {
    return false;
  }
}

/**
 * Check if ffmpeg and ffprobe are available
 */
export async function checkFFmpegDependencies(
  ffmpegPath = 'ffmpeg',
  ffprobePath = 'ffprobe'
): Promise<{ ffmpeg: boolean; ffprobe: boolean }> {
  return {
    ffmpeg: await checkCommand(ffmpegPath),
    ffprobe: await checkCommand(ffprobePath),
  };
}


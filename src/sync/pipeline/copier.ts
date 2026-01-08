/**
 * File Copier
 * Copies files with progress tracking
 */

import { join, dirname, basename } from 'https://deno.land/std@0.224.0/path/mod.ts';

/** Progress callback for copy operations */
export type CopyProgressCallback = (
  bytesTransferred: number,
  totalBytes: number,
  filename: string
) => void;

/** Copy a file with progress tracking */
export async function copyFileWithProgress(
  sourcePath: string,
  destPath: string,
  progressCallback?: CopyProgressCallback,
  chunkSize = 1024 * 1024 // 1MB chunks
): Promise<void> {
  // Ensure destination directory exists
  await Deno.mkdir(dirname(destPath), { recursive: true });

  const sourceFile = await Deno.open(sourcePath, { read: true });
  const destFile = await Deno.open(destPath, { write: true, create: true, truncate: true });

  try {
    const stat = await Deno.stat(sourcePath);
    const totalBytes = stat.size;
    let bytesTransferred = 0;
    const filename = basename(sourcePath);

    const buffer = new Uint8Array(chunkSize);

    while (true) {
      const bytesRead = await sourceFile.read(buffer);
      if (bytesRead === null) break;

      const chunk = bytesRead < chunkSize ? buffer.subarray(0, bytesRead) : buffer;
      await destFile.write(chunk);

      bytesTransferred += bytesRead;
      progressCallback?.(bytesTransferred, totalBytes, filename);
    }
  } finally {
    sourceFile.close();
    destFile.close();
  }
}

/** Copy a directory recursively with progress tracking */
export async function copyDirectoryWithProgress(
  sourceDir: string,
  destDir: string,
  progressCallback?: (
    currentFile: number,
    totalFiles: number,
    bytesTransferred: number,
    totalBytes: number,
    filename: string
  ) => void
): Promise<void> {
  // First, collect all files and calculate total size
  const files: { source: string; dest: string; size: number }[] = [];
  let totalBytes = 0;

  async function collectFiles(srcDir: string, dstDir: string): Promise<void> {
    await Deno.mkdir(dstDir, { recursive: true });

    for await (const entry of Deno.readDir(srcDir)) {
      const srcPath = join(srcDir, entry.name);
      const dstPath = join(dstDir, entry.name);

      if (entry.isDirectory) {
        await collectFiles(srcPath, dstPath);
      } else if (entry.isFile) {
        const stat = await Deno.stat(srcPath);
        files.push({ source: srcPath, dest: dstPath, size: stat.size });
        totalBytes += stat.size;
      }
    }
  }

  await collectFiles(sourceDir, destDir);

  // Copy files with progress
  let bytesTransferred = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    await copyFileWithProgress(file.source, file.dest, (transferred, total, filename) => {
      progressCallback?.(
        i + 1,
        files.length,
        bytesTransferred + transferred,
        totalBytes,
        filename
      );
    });

    bytesTransferred += file.size;
  }
}

/** Move a file (copy then delete source) */
export async function moveFile(sourcePath: string, destPath: string): Promise<void> {
  try {
    // Try rename first (fast if on same filesystem)
    await Deno.rename(sourcePath, destPath);
  } catch {
    // Fall back to copy + delete
    await Deno.copyFile(sourcePath, destPath);
    await Deno.remove(sourcePath);
  }
}

/** Move a directory (copy then delete source) */
export async function moveDirectory(sourceDir: string, destDir: string): Promise<void> {
  try {
    // Try rename first
    await Deno.rename(sourceDir, destDir);
  } catch {
    // Fall back to recursive copy + delete
    await copyDirectoryWithProgress(sourceDir, destDir);
    await Deno.remove(sourceDir, { recursive: true });
  }
}

/** Calculate directory size */
export async function getDirectorySize(dir: string): Promise<number> {
  let totalSize = 0;

  async function walk(path: string): Promise<void> {
    for await (const entry of Deno.readDir(path)) {
      const fullPath = join(path, entry.name);
      if (entry.isDirectory) {
        await walk(fullPath);
      } else if (entry.isFile) {
        const stat = await Deno.stat(fullPath);
        totalSize += stat.size;
      }
    }
  }

  await walk(dir);
  return totalSize;
}

/** Clean up temporary directory */
export async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await Deno.remove(tempDir, { recursive: true });
  } catch (error) {
    console.warn(`Failed to clean up temp directory ${tempDir}:`, error);
  }
}

/** Ensure directory exists */
export async function ensureDir(dir: string): Promise<void> {
  await Deno.mkdir(dir, { recursive: true });
}


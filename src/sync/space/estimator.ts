/**
 * Size Estimator
 * Estimates transcoded file sizes based on duration and target bitrate
 */

import type { SyncItem } from '../types.ts';
import type { BitrateConfig } from '../../transcode/types.ts';
import {
  DEFAULT_BITRATES,
  DEFAULT_AUDIO_BITRATE,
  CONTAINER_OVERHEAD_FACTOR,
} from '../../shared/constants.ts';
import {
  formatBytes as sharedFormatBytes,
  parseBytes as sharedParseBytes,
  parseBitrateString as sharedParseBitrateString,
} from '../../shared/format.ts';

/** Determine resolution category from dimensions */
function getResolutionCategory(width: number, height: number): string {
  const pixels = width * height;

  if (pixels >= 3840 * 2160 * 0.8) return '4k';
  if (pixels >= 1920 * 1080 * 0.8) return '1080p';
  if (pixels >= 1280 * 720 * 0.8) return '720p';
  return '480p';
}

/** Get target bitrate for a resolution */
export function getTargetBitrate(
  width: number,
  height: number,
  bitrateConfig?: BitrateConfig
): number {
  const category = getResolutionCategory(width, height);

  if (bitrateConfig) {
    switch (category) {
      case '4k':
        return sharedParseBitrateString(bitrateConfig.high) || DEFAULT_BITRATES['4k'];
      case '1080p':
        return sharedParseBitrateString(bitrateConfig.medium) || DEFAULT_BITRATES['1080p'];
      case '720p':
        return sharedParseBitrateString(bitrateConfig.low) || DEFAULT_BITRATES['720p'];
      case '480p':
        return sharedParseBitrateString(bitrateConfig.low) || DEFAULT_BITRATES['480p'];
    }
  }

  return DEFAULT_BITRATES[category as keyof typeof DEFAULT_BITRATES] || DEFAULT_BITRATES.default;
}

/** Estimate transcoded file size in bytes */
export function estimateTranscodedSize(
  durationSeconds: number,
  width: number,
  height: number,
  bitrateConfig?: BitrateConfig
): number {
  const videoBitrate = getTargetBitrate(width, height, bitrateConfig);
  const totalBitrate = videoBitrate + DEFAULT_AUDIO_BITRATE;

  // Size = bitrate (bits/sec) * duration (sec) / 8 (bits/byte) * overhead
  const estimatedBytes = ((totalBitrate * durationSeconds) / 8) * CONTAINER_OVERHEAD_FACTOR;

  return Math.ceil(estimatedBytes);
}

/** Estimate size for a sync item */
export function estimateItemSize(
  item: SyncItem,
  bitrateConfig?: BitrateConfig
): number {
  // Use resolution if available, otherwise assume 1080p
  const width = item.resolution?.width || 1920;
  const height = item.resolution?.height || 1080;

  if (item.type === 'tv_season' && item.episodes) {
    // Sum up all episode durations
    let totalDuration = 0;
    for (const episode of item.episodes) {
      totalDuration += episode.duration || 2700; // Default 45 min per episode
    }
    return estimateTranscodedSize(totalDuration, width, height, bitrateConfig);
  }

  // For movies, use the item's duration
  const duration = item.duration || 7200; // Default 2 hours
  return estimateTranscodedSize(duration, width, height, bitrateConfig);
}

/** Update estimated sizes for all items */
export function updateEstimatedSizes(
  items: SyncItem[],
  bitrateConfig?: BitrateConfig
): void {
  for (const item of items) {
    item.estimatedSize = estimateItemSize(item, bitrateConfig);
  }
}

/**
 * Format bytes as human-readable string
 * Re-export from shared for backward compatibility
 */
export const formatBytes = sharedFormatBytes;

/**
 * Parse human-readable size to bytes
 * Re-export from shared for backward compatibility
 */
export const parseBytes = sharedParseBytes;

/** Calculate compression ratio estimate */
export function estimateCompressionRatio(
  originalSize: number,
  estimatedSize: number
): number {
  if (originalSize === 0) return 1;
  return originalSize / estimatedSize;
}

/** Summary of size estimates */
export interface SizeEstimateSummary {
  totalOriginalSize: number;
  totalEstimatedSize: number;
  compressionRatio: number;
  itemCount: number;
  byType: {
    movies: { count: number; originalSize: number; estimatedSize: number };
    tvSeasons: { count: number; originalSize: number; estimatedSize: number };
  };
}

/** Generate summary of size estimates */
export function generateSizeEstimateSummary(items: SyncItem[]): SizeEstimateSummary {
  const summary: SizeEstimateSummary = {
    totalOriginalSize: 0,
    totalEstimatedSize: 0,
    compressionRatio: 1,
    itemCount: items.length,
    byType: {
      movies: { count: 0, originalSize: 0, estimatedSize: 0 },
      tvSeasons: { count: 0, originalSize: 0, estimatedSize: 0 },
    },
  };

  for (const item of items) {
    // For original size, we need to calculate from episodes for TV seasons
    let originalSize = 0;
    if (item.type === 'tv_season' && item.episodes) {
      originalSize = item.episodes.reduce((sum, ep) => sum + ep.size, 0);
      summary.byType.tvSeasons.count++;
      summary.byType.tvSeasons.originalSize += originalSize;
      summary.byType.tvSeasons.estimatedSize += item.estimatedSize;
    } else {
      // For movies, estimatedSize was set from original size initially
      // We need to track original separately
      originalSize = item.estimatedSize * 2; // Rough estimate if not tracked
      summary.byType.movies.count++;
      summary.byType.movies.originalSize += originalSize;
      summary.byType.movies.estimatedSize += item.estimatedSize;
    }

    summary.totalOriginalSize += originalSize;
    summary.totalEstimatedSize += item.estimatedSize;
  }

  if (summary.totalEstimatedSize > 0) {
    summary.compressionRatio = summary.totalOriginalSize / summary.totalEstimatedSize;
  }

  return summary;
}


/**
 * Formatting utilities for danger-transcode
 * Centralized formatting functions used by both modules
 */

/**
 * Format bytes as human-readable string
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "1.50 GB")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);

  return `${value.toFixed(2)} ${units[exponent]}`;
}

/** Alias for formatBytes for backward compatibility */
export const formatFileSize = formatBytes;

/**
 * Format duration in seconds as human-readable string
 * @param seconds - Duration in seconds
 * @returns Formatted string (e.g., "1h 30m 45s")
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) return '0s';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Format bitrate for display
 * @param bitsPerSecond - Bitrate in bits per second
 * @returns Formatted string (e.g., "5.0 Mbps")
 */
export function formatBitrate(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1_000_000) {
    return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`;
  } else if (bitsPerSecond >= 1_000) {
    return `${(bitsPerSecond / 1_000).toFixed(0)} Kbps`;
  }
  return `${bitsPerSecond} bps`;
}

/**
 * Parse bitrate string to number of bits per second
 * @param bitrateStr - Bitrate string (e.g., "2M", "5M", "192K")
 * @returns Bitrate in bits per second
 */
export function parseBitrateString(bitrateStr: string): number {
  const match = bitrateStr.match(/^(\d+(?:\.\d+)?)\s*([KMG])?/i);
  if (!match) return parseInt(bitrateStr, 10) || 0;

  const value = parseFloat(match[1]);
  const unit = match[2]?.toUpperCase() || '';

  switch (unit) {
    case 'K':
      return value * 1_000;
    case 'M':
      return value * 1_000_000;
    case 'G':
      return value * 1_000_000_000;
    default:
      return value;
  }
}

/**
 * Parse human-readable size string to bytes
 * @param sizeStr - Size string (e.g., "1.5 GB", "500 MB")
 * @returns Size in bytes
 * @throws Error if format is invalid
 */
export function parseBytes(sizeStr: string): number {
  const match = sizeStr.match(/^([\d.]+)\s*(B|KB|MB|GB|TB|PB)?$/i);
  if (!match) {
    throw new Error(`Invalid size format: ${sizeStr}`);
  }

  const value = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();

  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
    PB: 1024 ** 5,
  };

  return Math.ceil(value * multipliers[unit]);
}

/**
 * Format a number with commas as thousands separators
 * @param num - Number to format
 * @returns Formatted string (e.g., "1,234,567")
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Format a percentage
 * @param value - Value (0-1 or 0-100)
 * @param isDecimal - If true, value is 0-1, otherwise 0-100
 * @param decimals - Number of decimal places
 * @returns Formatted string (e.g., "75.5%")
 */
export function formatPercentage(value: number, isDecimal = false, decimals = 1): string {
  const pct = isDecimal ? value * 100 : value;
  return `${pct.toFixed(decimals)}%`;
}

/**
 * Format a timestamp for logging
 * @param date - Date object (defaults to now)
 * @returns ISO-like timestamp string
 */
export function formatTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Truncate a string with ellipsis
 * @param str - String to truncate
 * @param maxLength - Maximum length
 * @returns Truncated string
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Pad a string to a fixed width
 * @param str - String to pad
 * @param width - Target width
 * @param char - Character to use for padding
 * @param align - Alignment ('left' | 'right' | 'center')
 */
export function pad(
  str: string,
  width: number,
  char = ' ',
  align: 'left' | 'right' | 'center' = 'left'
): string {
  if (str.length >= width) return str;
  const padding = width - str.length;

  switch (align) {
    case 'right':
      return char.repeat(padding) + str;
    case 'center': {
      const left = Math.floor(padding / 2);
      const right = padding - left;
      return char.repeat(left) + str + char.repeat(right);
    }
    default:
      return str + char.repeat(padding);
  }
}


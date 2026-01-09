/**
 * Media Matcher module for danger-transcode
 * Provides fuzzy matching for media selection using Fuse.js
 */

import Fuse, { type IFuseOptions } from 'fuse.js';
import { basename, dirname } from '@std/path';
import type { MediaEntry, MatchResult, LibraryType } from './types.ts';
import { getLogger } from './logger.ts';

const logger = getLogger().child('media-matcher');

//═══════════════════════════════════════════════════════════════════════════════
// NAME CLEANING UTILITIES
//═══════════════════════════════════════════════════════════════════════════════

/**
 * Clean a media name for better matching
 * Removes common artifacts like year, quality tags, etc.
 */
export function cleanMediaName(name: string): string {
  let cleaned = name;

  // Remove file extension
  cleaned = cleaned.replace(/\.[^.]+$/, '');

  // Remove year in parentheses or brackets: (2020), [2020]
  cleaned = cleaned.replace(/[\(\[]?\d{4}[\)\]]?/g, '');

  // Remove quality tags: 720p, 1080p, 4K, etc.
  cleaned = cleaned.replace(/\b(720p?|1080p?|2160p?|4k|uhd|hdr|hdr10|dolby\s*vision)\b/gi, '');

  // Remove codec tags: x264, x265, hevc, h264, etc.
  cleaned = cleaned.replace(/\b(x264|x265|h\.?264|h\.?265|hevc|avc|xvid|divx)\b/gi, '');

  // Remove source tags: BluRay, WEB-DL, etc.
  cleaned = cleaned.replace(
    /\b(bluray|blu-ray|bdrip|brrip|web-?dl|webrip|hdtv|dvdrip|dvd|hdrip)\b/gi,
    '',
  );

  // Remove audio tags: DTS, AAC, etc.
  cleaned = cleaned.replace(/\b(dts|dts-?hd|truehd|atmos|aac|ac3|flac|mp3)\b/gi, '');

  // Remove release group tags (usually at end after dash)
  cleaned = cleaned.replace(/-[A-Za-z0-9]+$/, '');

  // Replace dots, underscores with spaces
  cleaned = cleaned.replace(/[._]/g, ' ');

  // Remove extra whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

/**
 * Extract year from a media name
 */
export function extractYear(name: string): number | undefined {
  // Match year in parentheses first: (2020)
  const parenMatch = name.match(/\((\d{4})\)/);
  if (parenMatch) {
    const year = parseInt(parenMatch[1], 10);
    if (year >= 1900 && year <= 2100) return year;
  }

  // Match standalone year
  const yearMatch = name.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    return parseInt(yearMatch[1], 10);
  }

  return undefined;
}

//═══════════════════════════════════════════════════════════════════════════════
// MEDIA INDEX
//═══════════════════════════════════════════════════════════════════════════════

/** Fuse.js options for fuzzy matching */
const FUSE_OPTIONS: IFuseOptions<MediaEntry> = {
  keys: [
    { name: 'name', weight: 0.7 },
    { name: 'originalName', weight: 0.3 },
  ],
  threshold: 0.4, // 0 = exact match, 1 = match anything
  distance: 100,
  includeScore: true,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

/**
 * Media index for fuzzy searching
 */
export class MediaIndex {
  private entries: MediaEntry[] = [];
  private fuse: Fuse<MediaEntry> | null = null;

  /**
   * Add a media entry to the index
   */
  addEntry(entry: MediaEntry): void {
    this.entries.push(entry);
    this.fuse = null; // Invalidate index
  }

  /**
   * Build the Fuse.js index
   */
  private buildIndex(): void {
    if (!this.fuse) {
      this.fuse = new Fuse(this.entries, FUSE_OPTIONS);
      logger.debug(`Built media index with ${this.entries.length} entries`);
    }
  }

  /**
   * Search for media matching a query
   */
  search(query: string, library?: LibraryType, limit = 10): MatchResult[] {
    this.buildIndex();
    if (!this.fuse) return [];

    // Clean the query for better matching
    const cleanedQuery = cleanMediaName(query);
    logger.debug(`Searching for: "${query}" (cleaned: "${cleanedQuery}")`);

    // Search with Fuse.js
    const results = this.fuse.search(cleanedQuery, { limit: limit * 2 });

    // Filter by library type if specified
    let filtered = results;
    if (library && library !== 'both') {
      filtered = results.filter((r) => r.item.library === library);
    }

    // Convert to MatchResult format
    return filtered.slice(0, limit).map((r) => ({
      entry: r.item,
      score: 1 - (r.score ?? 0), // Convert to 0-1 where 1 is best
      matchedQuery: query,
    }));
  }

  /**
   * Find exact match (case-insensitive)
   */
  findExact(query: string, library?: LibraryType): MediaEntry | undefined {
    const normalizedQuery = query.toLowerCase().trim();

    return this.entries.find((entry) => {
      if (library && library !== 'both' && entry.library !== library) {
        return false;
      }
      return (
        entry.name.toLowerCase() === normalizedQuery ||
        entry.originalName.toLowerCase() === normalizedQuery
      );
    });
  }

  /**
   * Get all entries
   */
  getEntries(): MediaEntry[] {
    return [...this.entries];
  }

  /**
   * Get entry count
   */
  get size(): number {
    return this.entries.length;
  }
}

//═══════════════════════════════════════════════════════════════════════════════
// INDEX BUILDING
//═══════════════════════════════════════════════════════════════════════════════

/**
 * Determine library type from path
 * Looks for common patterns like /tv/, /movies/, /series/, etc.
 */
export function detectLibraryType(path: string): 'tv' | 'movie' {
  const lowerPath = path.toLowerCase();

  // TV show indicators
  const tvPatterns = ['/tv/', '/tv shows/', '/series/', '/shows/', '/television/'];
  if (tvPatterns.some((p) => lowerPath.includes(p))) {
    return 'tv';
  }

  // Season/Episode patterns in path
  if (/[\/\\]s\d{1,2}[\/\\]/i.test(path) || /season\s*\d+/i.test(path)) {
    return 'tv';
  }

  // Movie indicators
  const moviePatterns = ['/movies/', '/films/', '/film/'];
  if (moviePatterns.some((p) => lowerPath.includes(p))) {
    return 'movie';
  }

  // Default to movie if unclear
  return 'movie';
}

/**
 * Extract season numbers from a TV show directory
 */
export function extractSeasons(showPath: string): number[] {
  const seasons: number[] = [];

  try {
    for (const entry of Deno.readDirSync(showPath)) {
      if (entry.isDirectory) {
        // Match "Season X", "S01", etc.
        const match = entry.name.match(/(?:season\s*|s)(\d+)/i);
        if (match) {
          seasons.push(parseInt(match[1], 10));
        }
      }
    }
  } catch {
    // Directory not accessible
  }

  return seasons.sort((a, b) => a - b);
}

/**
 * Build media index from directory paths
 */
export async function buildMediaIndex(mediaDirs: string[]): Promise<MediaIndex> {
  const index = new MediaIndex();

  for (const mediaDir of mediaDirs) {
    logger.info(`Indexing media directory: ${mediaDir}`);

    try {
      // Walk top-level directories (each is typically a show or movie)
      for await (const entry of Deno.readDir(mediaDir)) {
        if (!entry.isDirectory) continue;

        const fullPath = `${mediaDir}/${entry.name}`;
        const library = detectLibraryType(fullPath);
        const cleanedName = cleanMediaName(entry.name);
        const year = extractYear(entry.name);

        const mediaEntry: MediaEntry = {
          name: cleanedName,
          originalName: entry.name,
          path: fullPath,
          library,
          year,
        };

        // For TV shows, extract available seasons
        if (library === 'tv') {
          mediaEntry.seasons = extractSeasons(fullPath);
        }

        index.addEntry(mediaEntry);
      }
    } catch (error) {
      logger.warn(`Failed to index directory ${mediaDir}: ${error}`);
    }
  }

  logger.info(`Media index built with ${index.size} entries`);
  return index;
}

/**
 * Match a query against the media index
 * Supports:
 * - Exact match: "Breaking Bad"
 * - Wildcard: "Breaking*"
 * - Fuzzy: "braking bad" (typo)
 */
export function matchMedia(
  index: MediaIndex,
  query: string,
  library?: LibraryType,
): MatchResult[] {
  // Check for wildcard pattern
  if (query.includes('*')) {
    const pattern = new RegExp(
      '^' + query.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
      'i',
    );

    return index
      .getEntries()
      .filter((entry) => {
        if (library && library !== 'both' && entry.library !== library) {
          return false;
        }
        return pattern.test(entry.name) || pattern.test(entry.originalName);
      })
      .map((entry) => ({
        entry,
        score: 1.0, // Wildcard matches are considered exact
        matchedQuery: query,
      }));
  }

  // Try exact match first
  const exact = index.findExact(query, library);
  if (exact) {
    return [{ entry: exact, score: 1.0, matchedQuery: query }];
  }

  // Fall back to fuzzy search
  return index.search(query, library);
}


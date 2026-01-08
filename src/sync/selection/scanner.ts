/**
 * Library Scanner
 * Scans source directories to build an index of available media
 */

import { join, basename, dirname } from 'https://deno.land/std@0.224.0/path/mod.ts';
import type { MovieInfo, TVShowInfo, SeasonInfo, EpisodeInfo } from '../types.ts';

/** Video file extensions to scan */
const VIDEO_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.m2ts',
]);

/** Regex patterns for parsing media filenames */
const MOVIE_PATTERNS = [
  // Movie (2023).mkv or Movie.2023.mkv
  /^(.+?)[\.\s][\(\[]?(\d{4})[\)\]]?/,
  // Movie - 2023.mkv
  /^(.+?)\s*-\s*(\d{4})/,
];

const TV_SHOW_PATTERNS = [
  // Show Name - S01E01 - Episode Title.mkv
  /^(.+?)\s*-?\s*S(\d{1,2})E(\d{1,3})/i,
  // Show.Name.S01E01.mkv
  /^(.+?)[\.\s]S(\d{1,2})E(\d{1,3})/i,
  // Show Name 1x01.mkv
  /^(.+?)[\.\s](\d{1,2})x(\d{1,3})/i,
  // Show Name - 01x01.mkv
  /^(.+?)\s*-?\s*(\d{1,2})x(\d{1,3})/i,
];

const SEASON_FOLDER_PATTERN = /^Season\s*(\d{1,2})$/i;

/** Check if a path is a video file */
function isVideoFile(path: string): boolean {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

/** Parse movie filename to extract title and year */
export function parseMovieFilename(filename: string): { title: string; year?: number } | null {
  const name = basename(filename).replace(/\.[^.]+$/, ''); // Remove extension

  for (const pattern of MOVIE_PATTERNS) {
    const match = name.match(pattern);
    if (match) {
      const title = match[1].replace(/[\._]/g, ' ').trim();
      const year = parseInt(match[2], 10);
      if (year >= 1900 && year <= new Date().getFullYear() + 2) {
        return { title, year };
      }
    }
  }

  // Fallback: just use the filename as title
  return { title: name.replace(/[\._]/g, ' ').trim() };
}

/** Parse TV episode filename */
export function parseTVEpisodeFilename(
  filename: string
): { showTitle: string; season: number; episode: number; episodeTitle?: string } | null {
  const name = basename(filename).replace(/\.[^.]+$/, '');

  for (const pattern of TV_SHOW_PATTERNS) {
    const match = name.match(pattern);
    if (match) {
      const showTitle = match[1].replace(/[\._]/g, ' ').trim();
      const season = parseInt(match[2], 10);
      const episode = parseInt(match[3], 10);

      // Try to extract episode title (after the episode number)
      const afterMatch = name.substring(match[0].length);
      const titleMatch = afterMatch.match(/^[\.\s-]+(.+)/);
      const episodeTitle = titleMatch ? titleMatch[1].replace(/[\._]/g, ' ').trim() : undefined;

      return { showTitle, season, episode, episodeTitle };
    }
  }

  return null;
}

/** Parse season folder name */
export function parseSeasonFolder(folderName: string): number | null {
  const match = folderName.match(SEASON_FOLDER_PATTERN);
  return match ? parseInt(match[1], 10) : null;
}

/** Scan a directory for video files */
async function scanDirectory(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    for await (const entry of Deno.readDir(dir)) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory) {
        // Recursively scan subdirectories
        const subFiles = await scanDirectory(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile && isVideoFile(entry.name)) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.warn(`Error scanning directory ${dir}:`, error);
  }

  return files;
}

/** Get file size */
async function getFileSize(path: string): Promise<number> {
  try {
    const stat = await Deno.stat(path);
    return stat.size;
  } catch {
    return 0;
  }
}

/** Scan a movie library directory */
export async function scanMovieLibrary(
  sourceDir: string,
  progressCallback?: (current: number, total: number, title: string) => void
): Promise<MovieInfo[]> {
  const movies: MovieInfo[] = [];
  const videoFiles = await scanDirectory(sourceDir);

  let processed = 0;
  for (const filePath of videoFiles) {
    const parsed = parseMovieFilename(filePath);
    if (!parsed) continue;

    progressCallback?.(++processed, videoFiles.length, parsed.title);

    const size = await getFileSize(filePath);

    // Note: Duration will be filled in later when actually processing
    // Skipping probe here to keep scanning fast
    movies.push({
      title: parsed.title,
      year: parsed.year,
      path: filePath,
      size,
      duration: 0,
      genres: [],
    });
  }

  return movies;
}

/** Scan a TV show library directory */
export async function scanTVLibrary(
  sourceDir: string,
  progressCallback?: (current: number, total: number, title: string) => void
): Promise<TVShowInfo[]> {
  const shows: Map<string, TVShowInfo> = new Map();

  // First, scan for all video files
  const videoFiles = await scanDirectory(sourceDir);

  let processed = 0;
  for (const filePath of videoFiles) {
    const parsed = parseTVEpisodeFilename(filePath);
    if (!parsed) continue;

    progressCallback?.(++processed, videoFiles.length, `${parsed.showTitle} S${parsed.season}E${parsed.episode}`);

    // Get or create show entry
    const showKey = parsed.showTitle.toLowerCase();
    let show = shows.get(showKey);
    if (!show) {
      // Determine show path (parent of season folder or parent of file)
      const parentDir = dirname(filePath);
      const parentName = basename(parentDir);
      const seasonNum = parseSeasonFolder(parentName);
      const showPath = seasonNum !== null ? dirname(parentDir) : parentDir;

      show = {
        title: parsed.showTitle,
        path: showPath,
        seasons: [],
        genres: [],
      };
      shows.set(showKey, show);
    }

    // Get or create season entry
    let season = show.seasons.find((s) => s.seasonNumber === parsed.season);
    if (!season) {
      const parentDir = dirname(filePath);
      const parentName = basename(parentDir);
      const seasonPath = parseSeasonFolder(parentName) !== null ? parentDir : show.path;

      season = {
        seasonNumber: parsed.season,
        episodes: [],
        path: seasonPath,
        totalSize: 0,
      };
      show.seasons.push(season);
    }

    // Add episode
    const size = await getFileSize(filePath);

    // Note: Duration will be filled in later when actually processing
    season.episodes.push({
      episodeNumber: parsed.episode,
      title: parsed.episodeTitle,
      path: filePath,
      size,
      duration: 0,
    });

    season.totalSize += size;
  }

  // Sort seasons and episodes
  for (const show of shows.values()) {
    show.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
    for (const season of show.seasons) {
      season.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
    }
  }

  return Array.from(shows.values());
}

/** Combined library scan result */
export interface LibraryScanResult {
  movies: MovieInfo[];
  tvShows: TVShowInfo[];
  totalMovies: number;
  totalTVShows: number;
  totalSeasons: number;
  totalEpisodes: number;
  totalSize: number;
}

/** Scan all source directories */
export async function scanLibraries(
  sourceDirs: string[],
  progressCallback?: (phase: string, current: number, total: number, item: string) => void
): Promise<LibraryScanResult> {
  const allMovies: MovieInfo[] = [];
  const allTVShows: TVShowInfo[] = [];

  for (const sourceDir of sourceDirs) {
    // Detect if this is a movie or TV directory based on structure
    const entries: string[] = [];
    try {
      for await (const entry of Deno.readDir(sourceDir)) {
        entries.push(entry.name);
      }
    } catch {
      console.warn(`Cannot read directory: ${sourceDir}`);
      continue;
    }

    // Check for season folders to determine if it's a TV library
    const hasSeasonFolders = entries.some((name) => parseSeasonFolder(name) !== null);
    const hasTVPatterns = entries.some((name) => {
      const videoFiles = entries.filter((e) => isVideoFile(e));
      return videoFiles.some((f) => parseTVEpisodeFilename(f) !== null);
    });

    if (hasSeasonFolders || hasTVPatterns) {
      // Scan as TV library
      const shows = await scanTVLibrary(sourceDir, (current, total, title) => {
        progressCallback?.('Scanning TV Shows', current, total, title);
      });
      allTVShows.push(...shows);
    } else {
      // Scan as movie library
      const movies = await scanMovieLibrary(sourceDir, (current, total, title) => {
        progressCallback?.('Scanning Movies', current, total, title);
      });
      allMovies.push(...movies);
    }
  }

  // Calculate totals
  let totalSeasons = 0;
  let totalEpisodes = 0;
  let totalSize = 0;

  for (const movie of allMovies) {
    totalSize += movie.size;
  }

  for (const show of allTVShows) {
    totalSeasons += show.seasons.length;
    for (const season of show.seasons) {
      totalEpisodes += season.episodes.length;
      totalSize += season.totalSize;
    }
  }

  return {
    movies: allMovies,
    tvShows: allTVShows,
    totalMovies: allMovies.length,
    totalTVShows: allTVShows.length,
    totalSeasons,
    totalEpisodes,
    totalSize,
  };
}

/** Check if a file is a video file (exported for use elsewhere) */
export { isVideoFile };


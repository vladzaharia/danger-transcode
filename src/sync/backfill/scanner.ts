/**
 * Destination Scanner
 * Scans destination directories to find existing TV shows and movies
 */

import { join, basename, dirname, extname } from 'https://deno.land/std@0.224.0/path/mod.ts';
import type { DestinationContent, DestinationTVShow, DestinationSeason, DestinationMovie } from './types.ts';
import { parseTVEpisodeFilename, parseMovieFilename, parseSeasonFolder } from '../selection/scanner.ts';

/** Video file extensions */
const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.ts', '.m2ts']);

/** Check if a file is a video file */
function isVideoFile(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(extname(filename).toLowerCase());
}

/** Parse NFO file to extract TMDB ID */
async function parseTmdbIdFromNfo(nfoPath: string): Promise<number | undefined> {
  try {
    const content = await Deno.readTextFile(nfoPath);
    // Look for tmdbid tag
    const tmdbMatch = content.match(/<tmdbid>(\d+)<\/tmdbid>/i);
    if (tmdbMatch) {
      return parseInt(tmdbMatch[1], 10);
    }
    // Also check uniqueid with type tmdb
    const uniqueIdMatch = content.match(/<uniqueid[^>]*type="tmdb"[^>]*>(\d+)<\/uniqueid>/i);
    if (uniqueIdMatch) {
      return parseInt(uniqueIdMatch[1], 10);
    }
  } catch {
    // NFO doesn't exist or can't be read
  }
  return undefined;
}

/** Find NFO file for a show/movie directory */
async function findNfoFile(dir: string, type: 'tvshow' | 'movie'): Promise<string | undefined> {
  const candidates = type === 'tvshow' 
    ? ['tvshow.nfo']
    : ['movie.nfo'];
  
  for (const name of candidates) {
    const path = join(dir, name);
    try {
      await Deno.stat(path);
      return path;
    } catch {
      // File doesn't exist
    }
  }
  return undefined;
}

/** Scan a directory for TV shows */
async function scanTVShowDirectory(
  dir: string,
  progressCallback?: (current: number, total: number, item: string) => void
): Promise<DestinationTVShow[]> {
  const shows: Map<string, DestinationTVShow> = new Map();
  const entries: string[] = [];
  
  // Recursively find all video files
  async function findVideos(path: string): Promise<string[]> {
    const files: string[] = [];
    try {
      for await (const entry of Deno.readDir(path)) {
        const fullPath = join(path, entry.name);
        if (entry.isDirectory) {
          files.push(...await findVideos(fullPath));
        } else if (entry.isFile && isVideoFile(entry.name)) {
          files.push(fullPath);
        }
      }
    } catch {
      // Can't read directory
    }
    return files;
  }

  const videoFiles = await findVideos(dir);
  let processed = 0;

  for (const filePath of videoFiles) {
    const parsed = parseTVEpisodeFilename(filePath);
    if (!parsed) continue;

    progressCallback?.(++processed, videoFiles.length, `${parsed.showTitle} S${parsed.season}E${parsed.episode}`);

    const showKey = parsed.showTitle.toLowerCase();
    let show = shows.get(showKey);
    
    if (!show) {
      // Determine show path
      const parentDir = dirname(filePath);
      const parentName = basename(parentDir);
      const seasonNum = parseSeasonFolder(parentName);
      const showPath = seasonNum !== null ? dirname(parentDir) : parentDir;
      
      // Try to get TMDB ID from NFO
      const nfoPath = await findNfoFile(showPath, 'tvshow');
      const tmdbId = nfoPath ? await parseTmdbIdFromNfo(nfoPath) : undefined;

      show = {
        title: parsed.showTitle,
        path: showPath,
        tmdbId,
        seasons: [],
      };
      shows.set(showKey, show);
    }

    // Find or create season
    let season = show.seasons.find(s => s.seasonNumber === parsed.season);
    if (!season) {
      const parentDir = dirname(filePath);
      const parentName = basename(parentDir);
      const seasonPath = parseSeasonFolder(parentName) !== null ? parentDir : show.path;
      
      season = {
        seasonNumber: parsed.season,
        path: seasonPath,
        episodes: [],
      };
      show.seasons.push(season);
    }

    // Add episode number if not already present
    if (!season.episodes.includes(parsed.episode)) {
      season.episodes.push(parsed.episode);
    }
  }

  // Sort seasons and episodes
  for (const show of shows.values()) {
    show.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
    for (const season of show.seasons) {
      season.episodes.sort((a, b) => a - b);
    }
  }

  return Array.from(shows.values());
}

/** Scan a directory for movies */
async function scanMovieDirectory(
  dir: string,
  progressCallback?: (current: number, total: number, item: string) => void
): Promise<DestinationMovie[]> {
  const movies: DestinationMovie[] = [];

  // Find all video files
  async function findVideos(path: string): Promise<string[]> {
    const files: string[] = [];
    try {
      for await (const entry of Deno.readDir(path)) {
        const fullPath = join(path, entry.name);
        if (entry.isDirectory) {
          files.push(...await findVideos(fullPath));
        } else if (entry.isFile && isVideoFile(entry.name)) {
          files.push(fullPath);
        }
      }
    } catch {
      // Can't read directory
    }
    return files;
  }

  const videoFiles = await findVideos(dir);
  let processed = 0;

  for (const filePath of videoFiles) {
    const parsed = parseMovieFilename(filePath);
    if (!parsed) continue;

    // Skip if this looks like a TV episode
    if (parseTVEpisodeFilename(filePath)) continue;

    progressCallback?.(++processed, videoFiles.length, parsed.title);

    const movieDir = dirname(filePath);

    // Try to get TMDB ID from NFO
    const nfoPath = await findNfoFile(movieDir, 'movie');
    const tmdbId = nfoPath ? await parseTmdbIdFromNfo(nfoPath) : undefined;

    movies.push({
      title: parsed.title,
      year: parsed.year,
      path: filePath,
      tmdbId,
    });
  }

  return movies;
}

/** Scan destination directories for existing content */
export async function scanDestination(
  destDirs: string[],
  progressCallback?: (phase: string, current: number, total: number, item: string) => void
): Promise<DestinationContent> {
  const allShows: DestinationTVShow[] = [];
  const allMovies: DestinationMovie[] = [];

  for (const dir of destDirs) {
    progressCallback?.('Scanning destination', 0, 1, dir);

    // Scan for TV shows
    const shows = await scanTVShowDirectory(dir, (current, total, item) => {
      progressCallback?.('Scanning TV shows', current, total, item);
    });
    allShows.push(...shows);

    // Scan for movies
    const movies = await scanMovieDirectory(dir, (current, total, item) => {
      progressCallback?.('Scanning movies', current, total, item);
    });
    allMovies.push(...movies);
  }

  // Deduplicate shows by title
  const showMap = new Map<string, DestinationTVShow>();
  for (const show of allShows) {
    const key = show.title.toLowerCase();
    const existing = showMap.get(key);
    if (existing) {
      // Merge seasons
      for (const season of show.seasons) {
        const existingSeason = existing.seasons.find(s => s.seasonNumber === season.seasonNumber);
        if (existingSeason) {
          // Merge episodes
          for (const ep of season.episodes) {
            if (!existingSeason.episodes.includes(ep)) {
              existingSeason.episodes.push(ep);
            }
          }
          existingSeason.episodes.sort((a, b) => a - b);
        } else {
          existing.seasons.push(season);
        }
      }
      existing.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
    } else {
      showMap.set(key, show);
    }
  }

  return {
    tvShows: Array.from(showMap.values()),
    movies: allMovies,
  };
}

export { scanTVShowDirectory, scanMovieDirectory };


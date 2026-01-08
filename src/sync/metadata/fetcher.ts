/**
 * Metadata Fetcher
 * Coordinates fetching and writing all metadata for media items
 */

import { join, dirname, basename, extname } from 'https://deno.land/std@0.224.0/path/mod.ts';
import type { SyncItem, MetadataStatus } from '../types.ts';
import { TMDBClient } from '../tmdb/client.ts';
import { generateMovieNFO, generateTVShowNFO, generateEpisodeNFO, writeNFO, nfoExists } from './nfo.ts';
import { findSubtitles, copyAllSubtitles } from './subtitles.ts';

/** Check if a file exists */
async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Get metadata status for a media file */
export async function getMetadataStatus(mediaPath: string): Promise<MetadataStatus> {
  const dir = dirname(mediaPath);
  const name = basename(mediaPath, extname(mediaPath));

  const status: MetadataStatus = {
    nfo: false,
    poster: false,
    fanart: false,
    banner: false,
    logo: false,
    thumb: false,
    subtitles: [],
    missingTypes: [],
  };

  // Check NFO
  const nfoPath = join(dir, `${name}.nfo`);
  const movieNfoPath = join(dir, 'movie.nfo');
  status.nfo = await fileExists(nfoPath) || await fileExists(movieNfoPath);

  // Check images
  status.poster = await fileExists(join(dir, 'poster.jpg')) ||
                  await fileExists(join(dir, `${name}-poster.jpg`));
  status.fanart = await fileExists(join(dir, 'fanart.jpg')) ||
                  await fileExists(join(dir, `${name}-fanart.jpg`));
  status.banner = await fileExists(join(dir, 'banner.jpg'));
  status.logo = await fileExists(join(dir, 'logo.png'));
  status.thumb = await fileExists(join(dir, `${name}-thumb.jpg`));

  // Check subtitles
  const subtitles = await findSubtitles(mediaPath);
  status.subtitles = subtitles.map((s) => s.filename);

  // Determine missing types
  if (!status.nfo) status.missingTypes.push('nfo');
  if (!status.poster) status.missingTypes.push('poster');
  if (!status.fanart) status.missingTypes.push('fanart');

  return status;
}

/** Fetch and write movie metadata */
export async function fetchMovieMetadata(
  item: SyncItem,
  destDir: string,
  tmdbClient: TMDBClient,
  options: { nfo?: boolean; images?: boolean; subtitles?: boolean } = {}
): Promise<MetadataStatus> {
  const { nfo = true, images = true, subtitles = true } = options;
  const status = await getMetadataStatus(join(destDir, basename(item.sourcePath)));

  // Ensure destination directory exists
  await Deno.mkdir(destDir, { recursive: true });

  // Fetch TMDB data if we have an ID
  if (item.tmdbId && (nfo || images)) {
    try {
      const movieDetails = await tmdbClient.getMovieDetails(item.tmdbId);
      const credits = await tmdbClient.getMovieCredits(item.tmdbId);

      // Generate and write NFO
      if (nfo && !status.nfo) {
        const nfoContent = generateMovieNFO(movieDetails, credits);
        await writeNFO(nfoContent, join(destDir, 'movie.nfo'));
        status.nfo = true;
        status.missingTypes = status.missingTypes.filter((t) => t !== 'nfo');
      }

      // Download images
      if (images) {
        const imageResults = await tmdbClient.downloadMovieImages(item.tmdbId, destDir, {
          poster: !status.poster,
          fanart: !status.fanart,
          logo: !status.logo,
        });

        if (imageResults.poster) {
          status.poster = true;
          status.missingTypes = status.missingTypes.filter((t) => t !== 'poster');
        }
        if (imageResults.fanart) {
          status.fanart = true;
          status.missingTypes = status.missingTypes.filter((t) => t !== 'fanart');
        }
        if (imageResults.logo) {
          status.logo = true;
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch TMDB metadata for ${item.title}:`, error);
    }
  }

  // Copy subtitles from source
  if (subtitles) {
    const destMediaPath = join(destDir, basename(item.sourcePath));
    const copiedSubs = await copyAllSubtitles(item.sourcePath, destMediaPath);
    status.subtitles = [...new Set([...status.subtitles, ...copiedSubs.map((p) => basename(p))])];
  }

  return status;
}

/** Fetch and write TV show metadata */
export async function fetchTVShowMetadata(
  item: SyncItem,
  destDir: string,
  tmdbClient: TMDBClient,
  options: { nfo?: boolean; images?: boolean; subtitles?: boolean } = {}
): Promise<MetadataStatus> {
  const { nfo = true, images = true, subtitles = true } = options;
  const status: MetadataStatus = {
    nfo: false,
    poster: false,
    fanart: false,
    banner: false,
    logo: false,
    thumb: false,
    subtitles: [],
    missingTypes: [],
  };

  // Ensure destination directory exists
  await Deno.mkdir(destDir, { recursive: true });

  // Fetch TMDB data if we have an ID
  if (item.tmdbId && (nfo || images)) {
    try {
      const showDetails = await tmdbClient.getTVShowDetails(item.tmdbId);

      // Generate and write show NFO
      if (nfo) {
        const nfoContent = generateTVShowNFO(showDetails);
        await writeNFO(nfoContent, join(destDir, 'tvshow.nfo'));
        status.nfo = true;
      }

      // Download show images
      if (images) {
        const imageResults = await tmdbClient.downloadTVShowImages(item.tmdbId, destDir);
        status.poster = imageResults.poster;
        status.fanart = imageResults.fanart;
        status.logo = imageResults.logo;
      }

      // Fetch season and episode metadata
      if (item.seasonNumber !== undefined && item.episodes) {
        const seasonDir = join(destDir, `Season ${item.seasonNumber.toString().padStart(2, '0')}`);
        await Deno.mkdir(seasonDir, { recursive: true });

        const seasonDetails = await tmdbClient.getSeasonDetails(item.tmdbId, item.seasonNumber);

        // Download season poster
        if (images && seasonDetails.poster_path) {
          await tmdbClient.downloadImage(
            seasonDetails.poster_path,
            join(seasonDir, 'poster.jpg'),
            'w500'
          );
        }

        // Generate episode NFOs
        if (nfo) {
          for (const episode of item.episodes) {
            const tmdbEpisode = seasonDetails.episodes.find(
              (e) => e.episode_number === episode.episodeNumber
            );

            if (tmdbEpisode) {
              const episodeNfo = generateEpisodeNFO(tmdbEpisode, item.title);
              const episodeBasename = basename(episode.path, extname(episode.path));
              await writeNFO(episodeNfo, join(seasonDir, `${episodeBasename}.nfo`));
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch TMDB metadata for ${item.title}:`, error);
    }
  }

  // Copy subtitles for each episode
  if (subtitles && item.episodes) {
    const seasonDir = join(destDir, `Season ${(item.seasonNumber || 1).toString().padStart(2, '0')}`);
    for (const episode of item.episodes) {
      const destEpisodePath = join(seasonDir, basename(episode.path));
      const copiedSubs = await copyAllSubtitles(episode.path, destEpisodePath);
      status.subtitles.push(...copiedSubs.map((p) => basename(p)));
    }
  }

  return status;
}

/** Scan destination for items with missing metadata */
export async function scanForMissingMetadata(
  destDir: string,
  progressCallback?: (current: number, total: number, item: string) => void
): Promise<{ path: string; status: MetadataStatus }[]> {
  const results: { path: string; status: MetadataStatus }[] = [];
  const videoExtensions = new Set(['.mkv', '.mp4', '.avi', '.mov', '.m4v']);

  async function scanDir(dir: string): Promise<void> {
    try {
      for await (const entry of Deno.readDir(dir)) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory) {
          await scanDir(fullPath);
        } else if (entry.isFile) {
          const ext = extname(entry.name).toLowerCase();
          if (videoExtensions.has(ext)) {
            const status = await getMetadataStatus(fullPath);
            if (status.missingTypes.length > 0) {
              results.push({ path: fullPath, status });
              progressCallback?.(results.length, -1, entry.name);
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Error scanning ${dir}:`, error);
    }
  }

  await scanDir(destDir);
  return results;
}

/** Fill missing metadata for existing media */
export async function fillMissingMetadata(
  items: { path: string; status: MetadataStatus }[],
  tmdbClient: TMDBClient,
  progressCallback?: (current: number, total: number, item: string) => void
): Promise<number> {
  let filled = 0;

  for (let i = 0; i < items.length; i++) {
    const { path, status } = items[i];
    progressCallback?.(i + 1, items.length, basename(path));

    // Try to identify the media from filename
    const name = basename(path, extname(path));
    const dir = dirname(path);

    // Search TMDB for the title
    try {
      // Extract title and year from filename
      const match = name.match(/^(.+?)[\.\s][\(\[]?(\d{4})[\)\]]?/);
      const title = match ? match[1].replace(/[\._]/g, ' ').trim() : name.replace(/[\._]/g, ' ').trim();
      const year = match ? parseInt(match[2], 10) : undefined;

      const searchResults = await tmdbClient.searchMovies(title, year);
      if (searchResults.length > 0) {
        const tmdbId = searchResults[0].id;

        // Fetch and write missing metadata
        if (status.missingTypes.includes('nfo')) {
          const movieDetails = await tmdbClient.getMovieDetails(tmdbId);
          const credits = await tmdbClient.getMovieCredits(tmdbId);
          const nfoContent = generateMovieNFO(movieDetails, credits);
          await writeNFO(nfoContent, join(dir, 'movie.nfo'));
        }

        if (status.missingTypes.includes('poster') || status.missingTypes.includes('fanart')) {
          await tmdbClient.downloadMovieImages(tmdbId, dir, {
            poster: status.missingTypes.includes('poster'),
            fanart: status.missingTypes.includes('fanart'),
          });
        }

        filled++;
      }
    } catch (error) {
      console.warn(`Failed to fill metadata for ${name}:`, error);
    }
  }

  return filled;
}


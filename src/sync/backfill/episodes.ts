/**
 * Episode Gap Analyzer
 * Detects missing episodes by comparing destination with source and TMDB
 */

import type { TMDBClient } from '../tmdb/client.ts';
import type { TVShowInfo, SeasonInfo, EpisodeInfo } from '../types.ts';
import type { DestinationTVShow, MissingEpisode, BackfillProgressCallback } from './types.ts';

/** Result of matching a destination show with source */
interface ShowMatch {
  destShow: DestinationTVShow;
  sourceShow?: TVShowInfo;
  tmdbId?: number;
}

/** Match destination shows with source library shows */
export function matchShowsWithSource(
  destShows: DestinationTVShow[],
  sourceShows: TVShowInfo[]
): ShowMatch[] {
  const matches: ShowMatch[] = [];
  
  // Create a map of source shows by normalized title
  const sourceMap = new Map<string, TVShowInfo>();
  for (const show of sourceShows) {
    sourceMap.set(normalizeTitle(show.title), show);
  }

  for (const destShow of destShows) {
    const normalizedTitle = normalizeTitle(destShow.title);
    const sourceShow = sourceMap.get(normalizedTitle);
    
    matches.push({
      destShow,
      sourceShow,
      tmdbId: destShow.tmdbId || sourceShow?.tmdbId,
    });
  }

  return matches;
}

/** Normalize a show title for matching */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/** Find missing episodes for a single show */
export async function findMissingEpisodesForShow(
  match: ShowMatch,
  tmdbClient: TMDBClient
): Promise<MissingEpisode[]> {
  const missing: MissingEpisode[] = [];
  const { destShow, sourceShow, tmdbId } = match;

  // If we have TMDB data, use it to find the total episode count
  if (tmdbId) {
    try {
      const showDetails = await tmdbClient.getTVShowDetails(tmdbId);
      
      // Check each season that exists on destination
      for (const destSeason of destShow.seasons) {
        // Get season details from TMDB
        const seasonDetails = await tmdbClient.getSeasonDetails(tmdbId, destSeason.seasonNumber);
        const totalEpisodes = seasonDetails.episodes.length;
        
        // Find which episodes are missing
        for (let epNum = 1; epNum <= totalEpisodes; epNum++) {
          if (!destSeason.episodes.includes(epNum)) {
            // This episode is missing
            const tmdbEpisode = seasonDetails.episodes.find(e => e.episode_number === epNum);
            
            // Check if we have it in source
            let sourcePath: string | undefined;
            let estimatedSize = 500 * 1024 * 1024; // Default 500MB estimate
            
            if (sourceShow) {
              const sourceSeason = sourceShow.seasons.find(s => s.seasonNumber === destSeason.seasonNumber);
              if (sourceSeason) {
                const sourceEp = sourceSeason.episodes.find(e => e.episodeNumber === epNum);
                if (sourceEp) {
                  sourcePath = sourceEp.path;
                  estimatedSize = sourceEp.size;
                }
              }
            }

            missing.push({
              showTitle: destShow.title,
              showTmdbId: tmdbId,
              seasonNumber: destSeason.seasonNumber,
              episodeNumber: epNum,
              sourcePath,
              estimatedSize,
              episodeTitle: tmdbEpisode?.name,
            });
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch TMDB data for ${destShow.title}:`, error);
    }
  } else if (sourceShow) {
    // No TMDB data, but we have source - compare directly
    for (const destSeason of destShow.seasons) {
      const sourceSeason = sourceShow.seasons.find(s => s.seasonNumber === destSeason.seasonNumber);
      if (!sourceSeason) continue;

      // Find episodes in source that aren't on destination
      for (const sourceEp of sourceSeason.episodes) {
        if (!destSeason.episodes.includes(sourceEp.episodeNumber)) {
          missing.push({
            showTitle: destShow.title,
            seasonNumber: destSeason.seasonNumber,
            episodeNumber: sourceEp.episodeNumber,
            sourcePath: sourceEp.path,
            estimatedSize: sourceEp.size,
            episodeTitle: sourceEp.title,
          });
        }
      }
    }
  }

  return missing;
}

/** Find all missing episodes across all shows */
export async function findAllMissingEpisodes(
  destShows: DestinationTVShow[],
  sourceShows: TVShowInfo[],
  tmdbClient: TMDBClient,
  progressCallback?: BackfillProgressCallback
): Promise<MissingEpisode[]> {
  const allMissing: MissingEpisode[] = [];
  const matches = matchShowsWithSource(destShows, sourceShows);

  let processed = 0;
  for (const match of matches) {
    progressCallback?.('Analyzing episodes', ++processed, matches.length, match.destShow.title);
    
    const missing = await findMissingEpisodesForShow(match, tmdbClient);
    allMissing.push(...missing);
  }

  // Sort by show, season, episode
  allMissing.sort((a, b) => {
    const showCompare = a.showTitle.localeCompare(b.showTitle);
    if (showCompare !== 0) return showCompare;
    const seasonCompare = a.seasonNumber - b.seasonNumber;
    if (seasonCompare !== 0) return seasonCompare;
    return a.episodeNumber - b.episodeNumber;
  });

  return allMissing;
}


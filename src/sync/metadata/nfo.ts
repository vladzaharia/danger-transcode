/**
 * NFO File Generator
 * Generates Kodi/Jellyfin compatible NFO files
 */

import type { MovieNFO, TVShowNFO, EpisodeNFO } from '../types.ts';
import type {
  TMDBMovieDetails,
  TMDBTVShowDetails,
  TMDBEpisode,
  TMDBCredits,
} from '../tmdb/types.ts';

/** XML escape special characters */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Format XML tag with optional value */
function tag(name: string, value: string | number | undefined | null, indent = 2): string {
  if (value === undefined || value === null || value === '') return '';
  const spaces = ' '.repeat(indent);
  return `${spaces}<${name}>${escapeXml(String(value))}</${name}>\n`;
}

/** Generate movie NFO from TMDB data */
export function generateMovieNFO(movie: TMDBMovieDetails, credits?: TMDBCredits): string {
  let nfo = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  nfo += '<movie>\n';

  nfo += tag('title', movie.title);
  nfo += tag('originaltitle', movie.original_title);
  nfo += tag('year', movie.release_date?.substring(0, 4));
  nfo += tag('plot', movie.overview);
  nfo += tag('tagline', movie.tagline);
  nfo += tag('runtime', movie.runtime);
  nfo += tag('premiered', movie.release_date);
  nfo += tag('status', movie.status);

  // Genres
  for (const genre of movie.genres) {
    nfo += tag('genre', genre.name);
  }

  // Studios
  for (const company of movie.production_companies.slice(0, 5)) {
    nfo += tag('studio', company.name);
  }

  // Ratings
  nfo += '  <ratings>\n';
  nfo += '    <rating name="tmdb" max="10" default="true">\n';
  nfo += `      <value>${movie.vote_average.toFixed(1)}</value>\n`;
  nfo += `      <votes>${movie.vote_count}</votes>\n`;
  nfo += '    </rating>\n';
  nfo += '  </ratings>\n';

  // Unique IDs
  nfo += `  <uniqueid type="tmdb" default="true">${movie.id}</uniqueid>\n`;
  if (movie.imdb_id) {
    nfo += `  <uniqueid type="imdb">${movie.imdb_id}</uniqueid>\n`;
  }

  // Credits
  if (credits) {
    // Directors
    const directors = credits.crew.filter((c) => c.job === 'Director');
    for (const director of directors) {
      nfo += tag('director', director.name);
    }

    // Writers
    const writers = credits.crew.filter((c) =>
      ['Writer', 'Screenplay', 'Story'].includes(c.job)
    );
    for (const writer of writers.slice(0, 5)) {
      nfo += tag('credits', writer.name);
    }

    // Cast
    for (const actor of credits.cast.slice(0, 20)) {
      nfo += '  <actor>\n';
      nfo += tag('name', actor.name, 4);
      nfo += tag('role', actor.character, 4);
      if (actor.profile_path) {
        nfo += tag('thumb', `https://image.tmdb.org/t/p/w185${actor.profile_path}`, 4);
      }
      nfo += tag('order', actor.order, 4);
      nfo += '  </actor>\n';
    }
  }

  // Collection
  if (movie.belongs_to_collection) {
    nfo += '  <set>\n';
    nfo += tag('name', movie.belongs_to_collection.name, 4);
    nfo += `    <overview></overview>\n`;
    nfo += '  </set>\n';
  }

  nfo += '</movie>\n';
  return nfo;
}

/** Generate TV show NFO from TMDB data */
export function generateTVShowNFO(show: TMDBTVShowDetails): string {
  let nfo = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  nfo += '<tvshow>\n';

  nfo += tag('title', show.name);
  nfo += tag('originaltitle', show.original_name);
  nfo += tag('year', show.first_air_date?.substring(0, 4));
  nfo += tag('plot', show.overview);
  nfo += tag('tagline', show.tagline);
  nfo += tag('premiered', show.first_air_date);
  nfo += tag('status', show.status);
  nfo += tag('season', show.number_of_seasons);
  nfo += tag('episode', show.number_of_episodes);

  // Genres
  for (const genre of show.genres) {
    nfo += tag('genre', genre.name);
  }

  // Studios/Networks
  for (const network of show.networks.slice(0, 3)) {
    nfo += tag('studio', network.name);
  }

  // Ratings
  nfo += '  <ratings>\n';
  nfo += '    <rating name="tmdb" max="10" default="true">\n';
  nfo += `      <value>${show.vote_average.toFixed(1)}</value>\n`;
  nfo += `      <votes>${show.vote_count}</votes>\n`;
  nfo += '    </rating>\n';
  nfo += '  </ratings>\n';

  // Unique IDs
  nfo += `  <uniqueid type="tmdb" default="true">${show.id}</uniqueid>\n`;
  if (show.external_ids?.imdb_id) {
    nfo += `  <uniqueid type="imdb">${show.external_ids.imdb_id}</uniqueid>\n`;
  }
  if (show.external_ids?.tvdb_id) {
    nfo += `  <uniqueid type="tvdb">${show.external_ids.tvdb_id}</uniqueid>\n`;
  }

  nfo += '</tvshow>\n';
  return nfo;
}

/** Generate episode NFO from TMDB data */
export function generateEpisodeNFO(episode: TMDBEpisode, showName: string): string {
  let nfo = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  nfo += '<episodedetails>\n';

  nfo += tag('title', episode.name);
  nfo += tag('showtitle', showName);
  nfo += tag('season', episode.season_number);
  nfo += tag('episode', episode.episode_number);
  nfo += tag('plot', episode.overview);
  nfo += tag('aired', episode.air_date);
  nfo += tag('runtime', episode.runtime);

  // Ratings
  if (episode.vote_count > 0) {
    nfo += '  <ratings>\n';
    nfo += '    <rating name="tmdb" max="10" default="true">\n';
    nfo += `      <value>${episode.vote_average.toFixed(1)}</value>\n`;
    nfo += `      <votes>${episode.vote_count}</votes>\n`;
    nfo += '    </rating>\n';
    nfo += '  </ratings>\n';
  }

  // Unique ID
  nfo += `  <uniqueid type="tmdb" default="true">${episode.id}</uniqueid>\n`;

  // Directors
  const directors = episode.crew.filter((c) => c.job === 'Director');
  for (const director of directors) {
    nfo += tag('director', director.name);
  }

  // Writers
  const writers = episode.crew.filter((c) =>
    ['Writer', 'Screenplay', 'Story', 'Teleplay'].includes(c.job)
  );
  for (const writer of writers.slice(0, 5)) {
    nfo += tag('credits', writer.name);
  }

  // Guest stars
  for (const guest of episode.guest_stars.slice(0, 10)) {
    nfo += '  <actor>\n';
    nfo += tag('name', guest.name, 4);
    nfo += tag('role', guest.character, 4);
    if (guest.profile_path) {
      nfo += tag('thumb', `https://image.tmdb.org/t/p/w185${guest.profile_path}`, 4);
    }
    nfo += '  </actor>\n';
  }

  // Thumbnail
  if (episode.still_path) {
    nfo += tag('thumb', `https://image.tmdb.org/t/p/w300${episode.still_path}`);
  }

  nfo += '</episodedetails>\n';
  return nfo;
}

/** Convert MovieNFO interface to XML string */
export function movieNFOToXml(nfo: MovieNFO): string {
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  xml += '<movie>\n';

  xml += tag('title', nfo.title);
  if (nfo.originalTitle) xml += tag('originaltitle', nfo.originalTitle);
  xml += tag('year', nfo.year);
  if (nfo.plot) xml += tag('plot', nfo.plot);
  if (nfo.outline) xml += tag('outline', nfo.outline);
  if (nfo.runtime) xml += tag('runtime', nfo.runtime);
  if (nfo.tagline) xml += tag('tagline', nfo.tagline);
  if (nfo.premiered) xml += tag('premiered', nfo.premiered);
  if (nfo.mpaa) xml += tag('mpaa', nfo.mpaa);

  for (const genre of nfo.genres) {
    xml += tag('genre', genre);
  }

  for (const studio of nfo.studios) {
    xml += tag('studio', studio);
  }

  for (const director of nfo.directors) {
    xml += tag('director', director);
  }

  for (const writer of nfo.writers) {
    xml += tag('credits', writer);
  }

  if (nfo.ratings.length > 0) {
    xml += '  <ratings>\n';
    for (const rating of nfo.ratings) {
      const defaultAttr = rating.source === 'tmdb' ? ' default="true"' : '';
      xml += `    <rating name="${rating.source}" max="10"${defaultAttr}>\n`;
      xml += `      <value>${rating.value.toFixed(1)}</value>\n`;
      if (rating.votes) xml += `      <votes>${rating.votes}</votes>\n`;
      xml += '    </rating>\n';
    }
    xml += '  </ratings>\n';
  }

  for (const uid of nfo.uniqueIds) {
    const defaultAttr = uid.default ? ' default="true"' : '';
    xml += `  <uniqueid type="${uid.type}"${defaultAttr}>${escapeXml(uid.value)}</uniqueid>\n`;
  }

  for (const actor of nfo.cast) {
    xml += '  <actor>\n';
    xml += tag('name', actor.name, 4);
    if (actor.role) xml += tag('role', actor.role, 4);
    if (actor.thumb) xml += tag('thumb', actor.thumb, 4);
    xml += '  </actor>\n';
  }

  xml += '</movie>\n';
  return xml;
}

/** Write NFO file to disk */
export async function writeNFO(content: string, destPath: string): Promise<void> {
  await Deno.writeTextFile(destPath, content);
}

/** Check if NFO file exists */
export async function nfoExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}


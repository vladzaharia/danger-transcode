/**
 * TMDB API Client
 * Handles all interactions with The Movie Database API
 */

import type {
  TMDBMovieListItem,
  TMDBMovieDetails,
  TMDBTVShowDetails,
  TMDBSeasonDetails,
  TMDBCollection,
  TMDBImages,
  TMDBPaginatedResponse,
  TMDBList,
  TMDBCredits,
  TMDBConfiguration,
  TMDBMultiSearchResult,
} from './types.ts';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

/** Cache entry with TTL */
interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  expiresAt: number;
}

/** TMDB client configuration */
export interface TMDBClientConfig {
  apiKey: string;
  readAccessToken?: string;
  language?: string;
  region?: string;
  cacheTTL?: number; // milliseconds, default 1 hour
}

/** TMDB API Client */
export class TMDBClient {
  private apiKey: string;
  private readAccessToken?: string;
  private language: string;
  private region: string;
  private cacheTTL: number;
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private configuration?: TMDBConfiguration;

  constructor(config: TMDBClientConfig) {
    this.apiKey = config.apiKey;
    this.readAccessToken = config.readAccessToken;
    this.language = config.language ?? 'en-US';
    this.region = config.region ?? 'US';
    this.cacheTTL = config.cacheTTL ?? 3600000; // 1 hour default
  }

  //═══════════════════════════════════════════════════════════════════════════
  // HTTP HELPERS
  //═══════════════════════════════════════════════════════════════════════════

  private async fetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const cacheKey = `${endpoint}?${JSON.stringify(params)}`;

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as T;
    }

    // Build URL with params
    const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('language', this.language);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    // Make request
    const response = await fetch(url.toString(), {
      headers: this.readAccessToken
        ? { Authorization: `Bearer ${this.readAccessToken}` }
        : {},
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`TMDB API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as T;

    // Cache the result
    this.cache.set(cacheKey, {
      data,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + this.cacheTTL,
    });

    return data;
  }

  private async fetchAllPages<T>(
    endpoint: string,
    params: Record<string, string> = {},
    maxPages = 10
  ): Promise<T[]> {
    const results: T[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= Math.min(totalPages, maxPages)) {
      const response = await this.fetch<TMDBPaginatedResponse<T>>(endpoint, {
        ...params,
        page: page.toString(),
      });
      results.push(...response.results);
      totalPages = response.total_pages;
      page++;
    }

    return results;
  }

  //═══════════════════════════════════════════════════════════════════════════
  // CONFIGURATION
  //═══════════════════════════════════════════════════════════════════════════

  async getConfiguration(): Promise<TMDBConfiguration> {
    if (!this.configuration) {
      this.configuration = await this.fetch<TMDBConfiguration>('/configuration');
    }
    return this.configuration;
  }

  /** Get the full image URL for a given path and size */
  getImageUrl(path: string | null, size: string = 'original'): string | null {
    if (!path) return null;
    return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
  }

  //═══════════════════════════════════════════════════════════════════════════
  // MOVIE ENDPOINTS
  //═══════════════════════════════════════════════════════════════════════════

  /** Get popular movies */
  async getPopularMovies(limit = 100): Promise<TMDBMovieListItem[]> {
    const maxPages = Math.ceil(limit / 20);
    const movies = await this.fetchAllPages<TMDBMovieListItem>('/movie/popular', {}, maxPages);
    return movies.slice(0, limit);
  }

  /** Get trending movies */
  async getTrendingMovies(timeWindow: 'day' | 'week' = 'week', limit = 100): Promise<TMDBMovieListItem[]> {
    const maxPages = Math.ceil(limit / 20);
    const movies = await this.fetchAllPages<TMDBMovieListItem>(
      `/trending/movie/${timeWindow}`,
      {},
      maxPages
    );
    return movies.slice(0, limit);
  }

  /** Get top-rated movies */
  async getTopRatedMovies(limit = 100): Promise<TMDBMovieListItem[]> {
    const maxPages = Math.ceil(limit / 20);
    const movies = await this.fetchAllPages<TMDBMovieListItem>('/movie/top_rated', {}, maxPages);
    return movies.slice(0, limit);
  }

  /** Get movie details by ID */
  async getMovieDetails(movieId: number): Promise<TMDBMovieDetails> {
    return this.fetch<TMDBMovieDetails>(`/movie/${movieId}`);
  }

  /** Get movie credits (cast and crew) */
  async getMovieCredits(movieId: number): Promise<TMDBCredits> {
    return this.fetch<TMDBCredits>(`/movie/${movieId}/credits`);
  }

  /** Get movie images */
  async getMovieImages(movieId: number): Promise<TMDBImages> {
    return this.fetch<TMDBImages>(`/movie/${movieId}/images`, {
      include_image_language: 'en,null',
    });
  }

  /** Search for movies by title */
  async searchMovies(query: string, year?: number): Promise<TMDBMovieListItem[]> {
    const params: Record<string, string> = { query };
    if (year) params.year = year.toString();
    return this.fetchAllPages<TMDBMovieListItem>('/search/movie', params, 3);
  }

  //═══════════════════════════════════════════════════════════════════════════
  // TV SHOW ENDPOINTS
  //═══════════════════════════════════════════════════════════════════════════

  /** Get TV show details by ID */
  async getTVShowDetails(tvId: number): Promise<TMDBTVShowDetails> {
    return this.fetch<TMDBTVShowDetails>(`/tv/${tvId}`, {
      append_to_response: 'external_ids',
    });
  }

  /** Get TV season details */
  async getSeasonDetails(tvId: number, seasonNumber: number): Promise<TMDBSeasonDetails> {
    return this.fetch<TMDBSeasonDetails>(`/tv/${tvId}/season/${seasonNumber}`);
  }

  /** Get TV show images */
  async getTVShowImages(tvId: number): Promise<TMDBImages> {
    return this.fetch<TMDBImages>(`/tv/${tvId}/images`, {
      include_image_language: 'en,null',
    });
  }

  /** Search for TV shows by title */
  async searchTVShows(query: string, year?: number): Promise<TMDBTVShowDetails[]> {
    const params: Record<string, string> = { query };
    if (year) params.first_air_date_year = year.toString();
    const results = await this.fetchAllPages<{ id: number }>('/search/tv', params, 3);
    // Fetch full details for each result
    return Promise.all(results.slice(0, 10).map((r) => this.getTVShowDetails(r.id)));
  }

  //═══════════════════════════════════════════════════════════════════════════
  // COLLECTION ENDPOINTS
  //═══════════════════════════════════════════════════════════════════════════

  /** Get collection details (franchise) */
  async getCollection(collectionId: number): Promise<TMDBCollection> {
    return this.fetch<TMDBCollection>(`/collection/${collectionId}`);
  }

  /** Get all movies in multiple collections */
  async getCollectionMovies(collectionIds: number[]): Promise<TMDBMovieListItem[]> {
    const allMovies: TMDBMovieListItem[] = [];
    const seenIds = new Set<number>();

    for (const collectionId of collectionIds) {
      try {
        const collection = await this.getCollection(collectionId);
        for (const movie of collection.parts) {
          if (!seenIds.has(movie.id)) {
            seenIds.add(movie.id);
            allMovies.push(movie);
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch collection ${collectionId}:`, error);
      }
    }

    return allMovies;
  }

  //═══════════════════════════════════════════════════════════════════════════
  // LIST ENDPOINTS
  //═══════════════════════════════════════════════════════════════════════════

  /** Get list details (v4 API) */
  async getList(listId: number): Promise<TMDBList> {
    return this.fetch<TMDBList>(`/list/${listId}`);
  }

  /** Get all items from multiple lists */
  async getListItems(listIds: number[]): Promise<TMDBMovieListItem[]> {
    const allItems: TMDBMovieListItem[] = [];
    const seenIds = new Set<number>();

    for (const listId of listIds) {
      try {
        const list = await this.getList(listId);
        for (const item of list.items) {
          if ('title' in item && !seenIds.has(item.id)) {
            seenIds.add(item.id);
            allItems.push(item);
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch list ${listId}:`, error);
      }
    }

    return allItems;
  }

  //═══════════════════════════════════════════════════════════════════════════
  // MULTI-SEARCH
  //═══════════════════════════════════════════════════════════════════════════

  /** Multi-search (movies, TV shows, people) */
  async multiSearch(query: string): Promise<TMDBMultiSearchResult[]> {
    return this.fetchAllPages<TMDBMultiSearchResult>('/search/multi', { query }, 3);
  }

  //═══════════════════════════════════════════════════════════════════════════
  // IMAGE DOWNLOADING
  //═══════════════════════════════════════════════════════════════════════════

  /** Download an image to a local file */
  async downloadImage(
    imagePath: string | null,
    destPath: string,
    size: string = 'original'
  ): Promise<boolean> {
    if (!imagePath) return false;

    const url = this.getImageUrl(imagePath, size);
    if (!url) return false;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Failed to download image: ${url}`);
        return false;
      }

      const arrayBuffer = await response.arrayBuffer();
      await Deno.writeFile(destPath, new Uint8Array(arrayBuffer));
      return true;
    } catch (error) {
      console.warn(`Error downloading image ${url}:`, error);
      return false;
    }
  }

  /** Download all images for a movie */
  async downloadMovieImages(
    movieId: number,
    destDir: string,
    options: { poster?: boolean; fanart?: boolean; logo?: boolean } = {}
  ): Promise<{ poster: boolean; fanart: boolean; logo: boolean }> {
    const result = { poster: false, fanart: false, logo: false };
    const { poster = true, fanart = true, logo = true } = options;

    try {
      const images = await this.getMovieImages(movieId);

      if (poster && images.posters.length > 0) {
        const best = images.posters.sort((a, b) => b.vote_average - a.vote_average)[0];
        result.poster = await this.downloadImage(best.file_path, `${destDir}/poster.jpg`, 'w500');
      }

      if (fanart && images.backdrops.length > 0) {
        const best = images.backdrops.sort((a, b) => b.vote_average - a.vote_average)[0];
        result.fanart = await this.downloadImage(best.file_path, `${destDir}/fanart.jpg`, 'w1280');
      }

      if (logo && images.logos.length > 0) {
        const best = images.logos.sort((a, b) => b.vote_average - a.vote_average)[0];
        result.logo = await this.downloadImage(best.file_path, `${destDir}/logo.png`, 'w500');
      }
    } catch (error) {
      console.warn(`Error downloading images for movie ${movieId}:`, error);
    }

    return result;
  }

  /** Download all images for a TV show */
  async downloadTVShowImages(
    tvId: number,
    destDir: string,
    options: { poster?: boolean; fanart?: boolean; logo?: boolean } = {}
  ): Promise<{ poster: boolean; fanart: boolean; logo: boolean }> {
    const result = { poster: false, fanart: false, logo: false };
    const { poster = true, fanart = true, logo = true } = options;

    try {
      const images = await this.getTVShowImages(tvId);

      if (poster && images.posters.length > 0) {
        const best = images.posters.sort((a, b) => b.vote_average - a.vote_average)[0];
        result.poster = await this.downloadImage(best.file_path, `${destDir}/poster.jpg`, 'w500');
      }

      if (fanart && images.backdrops.length > 0) {
        const best = images.backdrops.sort((a, b) => b.vote_average - a.vote_average)[0];
        result.fanart = await this.downloadImage(best.file_path, `${destDir}/fanart.jpg`, 'w1280');
      }

      if (logo && images.logos.length > 0) {
        const best = images.logos.sort((a, b) => b.vote_average - a.vote_average)[0];
        result.logo = await this.downloadImage(best.file_path, `${destDir}/logo.png`, 'w500');
      }
    } catch (error) {
      console.warn(`Error downloading images for TV show ${tvId}:`, error);
    }

    return result;
  }

  //═══════════════════════════════════════════════════════════════════════════
  // CACHE MANAGEMENT
  //═══════════════════════════════════════════════════════════════════════════

  /** Clear the cache */
  clearCache(): void {
    this.cache.clear();
  }

  /** Remove expired cache entries */
  cleanCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }

  /** Export cache for persistence */
  exportCache(): Record<string, { data: unknown; fetchedAt: number; expiresAt: number }> {
    const exported: Record<string, { data: unknown; fetchedAt: number; expiresAt: number }> = {};
    for (const [key, entry] of this.cache.entries()) {
      exported[key] = {
        data: entry.data,
        fetchedAt: entry.fetchedAt,
        expiresAt: entry.expiresAt,
      };
    }
    return exported;
  }

  /** Import cache from persistence */
  importCache(data: Record<string, { data: unknown; fetchedAt: number; expiresAt: number }>): void {
    const now = Date.now();
    for (const [key, entry] of Object.entries(data)) {
      if (entry.expiresAt > now) {
        this.cache.set(key, entry);
      }
    }
  }
}


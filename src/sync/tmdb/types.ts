/**
 * TMDB API response types
 */

/** TMDB genre object */
export interface TMDBGenre {
  id: number;
  name: string;
}

/** TMDB movie in list responses */
export interface TMDBMovieListItem {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  release_date: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  popularity: number;
  vote_average: number;
  vote_count: number;
  adult: boolean;
  original_language: string;
  video: boolean;
}

/** TMDB movie details response */
export interface TMDBMovieDetails {
  id: number;
  imdb_id: string | null;
  title: string;
  original_title: string;
  overview: string;
  tagline: string;
  status: string;
  release_date: string;
  runtime: number | null;
  budget: number;
  revenue: number;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: TMDBGenre[];
  production_companies: { id: number; name: string; logo_path: string | null; origin_country: string }[];
  production_countries: { iso_3166_1: string; name: string }[];
  spoken_languages: { iso_639_1: string; english_name: string; name: string }[];
  popularity: number;
  vote_average: number;
  vote_count: number;
  belongs_to_collection: { id: number; name: string; poster_path: string | null; backdrop_path: string | null } | null;
}

/** TMDB credits for a movie */
export interface TMDBCredits {
  id: number;
  cast: {
    id: number;
    name: string;
    character: string;
    profile_path: string | null;
    order: number;
  }[];
  crew: {
    id: number;
    name: string;
    job: string;
    department: string;
    profile_path: string | null;
  }[];
}

/** TMDB TV show in list responses */
export interface TMDBTVShowListItem {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  first_air_date: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  popularity: number;
  vote_average: number;
  vote_count: number;
  origin_country: string[];
  original_language: string;
}

/** TMDB TV show details response */
export interface TMDBTVShowDetails {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  tagline: string;
  status: string;
  type: string;
  first_air_date: string;
  last_air_date: string;
  number_of_seasons: number;
  number_of_episodes: number;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: TMDBGenre[];
  created_by: { id: number; name: string; profile_path: string | null }[];
  networks: { id: number; name: string; logo_path: string | null }[];
  production_companies: { id: number; name: string; logo_path: string | null }[];
  seasons: TMDBSeasonSummary[];
  external_ids?: {
    imdb_id: string | null;
    tvdb_id: number | null;
  };
  popularity: number;
  vote_average: number;
  vote_count: number;
}

/** TMDB season summary (in TV show details) */
export interface TMDBSeasonSummary {
  id: number;
  name: string;
  overview: string;
  season_number: number;
  episode_count: number;
  air_date: string | null;
  poster_path: string | null;
}

/** TMDB season details response */
export interface TMDBSeasonDetails {
  id: number;
  name: string;
  overview: string;
  season_number: number;
  air_date: string | null;
  poster_path: string | null;
  episodes: TMDBEpisode[];
}

/** TMDB episode details */
export interface TMDBEpisode {
  id: number;
  name: string;
  overview: string;
  episode_number: number;
  season_number: number;
  air_date: string | null;
  still_path: string | null;
  runtime: number | null;
  vote_average: number;
  vote_count: number;
  crew: { id: number; name: string; job: string }[];
  guest_stars: { id: number; name: string; character: string; profile_path: string | null }[];
}

/** TMDB collection details */
export interface TMDBCollection {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  parts: TMDBMovieListItem[];
}

/** TMDB images response */
export interface TMDBImages {
  id: number;
  backdrops: TMDBImage[];
  posters: TMDBImage[];
  logos: TMDBImage[];
}

/** TMDB image object */
export interface TMDBImage {
  aspect_ratio: number;
  file_path: string;
  height: number;
  width: number;
  iso_639_1: string | null;
  vote_average: number;
  vote_count: number;
}

/** TMDB paginated response */
export interface TMDBPaginatedResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

/** TMDB list details */
export interface TMDBList {
  id: number;
  name: string;
  description: string;
  poster_path: string | null;
  backdrop_path: string | null;
  item_count: number;
  items: (TMDBMovieListItem | TMDBTVShowListItem)[];
}

/** TMDB search results (multi-search) */
export interface TMDBMultiSearchResult {
  id: number;
  media_type: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path: string | null;
  popularity: number;
  vote_average?: number;
}

/** TMDB genre list response */
export interface TMDBGenreList {
  genres: TMDBGenre[];
}

/** TMDB configuration */
export interface TMDBConfiguration {
  images: {
    base_url: string;
    secure_base_url: string;
    poster_sizes: string[];
    backdrop_sizes: string[];
    logo_sizes: string[];
    still_sizes: string[];
    profile_sizes: string[];
  };
}

/** Oscar Best Picture winners - curated list since TMDB doesn't have direct endpoint */
export const OSCAR_BEST_PICTURE_WINNERS: { year: number; title: string; tmdbId: number }[] = [
  { year: 2025, title: 'Anora', tmdbId: 1064213 },
  { year: 2024, title: 'Oppenheimer', tmdbId: 872585 },
  { year: 2023, title: 'Everything Everywhere All at Once', tmdbId: 545611 },
  { year: 2022, title: 'CODA', tmdbId: 776503 },
  { year: 2021, title: 'Nomadland', tmdbId: 581734 },
  { year: 2020, title: 'Parasite', tmdbId: 496243 },
  { year: 2019, title: 'Green Book', tmdbId: 490132 },
  { year: 2018, title: 'The Shape of Water', tmdbId: 399055 },
  { year: 2017, title: 'Moonlight', tmdbId: 376867 },
  { year: 2016, title: 'Spotlight', tmdbId: 314365 },
];

/** Default franchise configurations with TMDB collection IDs */
export const DEFAULT_FRANCHISE_COLLECTIONS: Record<string, number[]> = {
  'Star Wars': [10],
  'Star Trek': [115575, 151],
  'Stargate': [2151],
  'Marvel Cinematic Universe': [131296],
  'DC Extended Universe': [209131],
  'Lord of the Rings': [119],
  'Harry Potter': [1241],
  'James Bond': [645],
  'Fast & Furious': [9485],
  'Mission Impossible': [87359],
  'Jurassic Park': [328],
  'Indiana Jones': [84],
  'The Matrix': [2344],
  'Pirates of the Caribbean': [295],
  'Toy Story': [10194],
};

/** TMDB genre ID to name mapping */
export const TMDB_MOVIE_GENRES: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
};

/** TMDB TV genre ID to name mapping */
export const TMDB_TV_GENRES: Record<number, string> = {
  10759: 'Action & Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  10762: 'Kids',
  9648: 'Mystery',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
  37: 'Western',
};


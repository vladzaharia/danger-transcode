/**
 * Franchise Pattern Matching
 * Matches media titles against franchise patterns
 */

import type { FranchiseConfig } from '../types.ts';

/** Default franchise configurations */
export const DEFAULT_FRANCHISES: FranchiseConfig[] = [
  {
    name: 'Star Trek',
    patterns: [
      'star\\s*trek',
      '^st:\\s*',
      'the\\s+original\\s+series',
      'the\\s+next\\s+generation',
      'deep\\s+space\\s+nine',
      'voyager',
      'enterprise',
      'discovery',
      'picard',
      'strange\\s+new\\s+worlds',
      'lower\\s+decks',
      'prodigy',
    ],
    tmdbCollections: [115575, 151], // TV and Movies
  },
  {
    name: 'Star Wars',
    patterns: [
      'star\\s*wars',
      'mandalorian',
      'andor',
      'obi-?wan\\s*kenobi',
      'ahsoka',
      'book\\s+of\\s+boba\\s+fett',
      'bad\\s+batch',
      'tales\\s+of\\s+the\\s+jedi',
      'acolyte',
      'skeleton\\s+crew',
    ],
    tmdbCollections: [10], // Main movie collection
  },
  {
    name: 'Stargate',
    patterns: [
      'stargate',
      'sg-?1',
      'atlantis',
      'universe',
      'origins',
    ],
    tmdbCollections: [2151],
  },
  {
    name: 'Marvel Cinematic Universe',
    patterns: [
      'iron\\s*man',
      'captain\\s*america',
      'thor',
      'avengers',
      'guardians\\s+of\\s+the\\s+galaxy',
      'ant-?man',
      'doctor\\s+strange',
      'spider-?man.*home',
      'black\\s+panther',
      'black\\s+widow',
      'eternals',
      'shang-?chi',
      'wandavision',
      'falcon.*winter\\s+soldier',
      'loki',
      'hawkeye',
      'moon\\s+knight',
      'ms\\.?\\s*marvel',
      'she-?hulk',
      'secret\\s+invasion',
      'echo',
      'agatha',
    ],
    tmdbCollections: [131296],
  },
  {
    name: 'DC Extended Universe',
    patterns: [
      'man\\s+of\\s+steel',
      'batman\\s+v\\s+superman',
      'suicide\\s+squad',
      'wonder\\s+woman',
      'justice\\s+league',
      'aquaman',
      'shazam',
      'birds\\s+of\\s+prey',
      'the\\s+flash',
      'blue\\s+beetle',
      'peacemaker',
    ],
    tmdbCollections: [209131],
  },
  {
    name: 'Lord of the Rings',
    patterns: [
      'lord\\s+of\\s+the\\s+rings',
      'lotr',
      'hobbit',
      'rings\\s+of\\s+power',
    ],
    tmdbCollections: [119, 121938],
  },
  {
    name: 'Harry Potter',
    patterns: [
      'harry\\s+potter',
      'fantastic\\s+beasts',
      'wizarding\\s+world',
    ],
    tmdbCollections: [1241, 435259],
  },
  {
    name: 'James Bond',
    patterns: [
      'james\\s+bond',
      '007',
      'casino\\s+royale',
      'quantum\\s+of\\s+solace',
      'skyfall',
      'spectre',
      'no\\s+time\\s+to\\s+die',
    ],
    tmdbCollections: [645],
  },
  {
    name: 'Fast & Furious',
    patterns: [
      'fast.*furious',
      'fast\\s+&\\s+furious',
      'f9',
      'fast\\s+x',
      'hobbs.*shaw',
    ],
    tmdbCollections: [9485],
  },
  {
    name: 'Mission Impossible',
    patterns: [
      'mission\\s*impossible',
      'mission:\\s*impossible',
    ],
    tmdbCollections: [87359],
  },
  {
    name: 'Jurassic Park',
    patterns: [
      'jurassic\\s+park',
      'jurassic\\s+world',
      'lost\\s+world.*jurassic',
    ],
    tmdbCollections: [328],
  },
  {
    name: 'Indiana Jones',
    patterns: [
      'indiana\\s+jones',
      'raiders\\s+of\\s+the\\s+lost\\s+ark',
    ],
    tmdbCollections: [84],
  },
  {
    name: 'The Matrix',
    patterns: [
      'matrix',
      'animatrix',
    ],
    tmdbCollections: [2344],
  },
  {
    name: 'Pirates of the Caribbean',
    patterns: [
      'pirates\\s+of\\s+the\\s+caribbean',
      'curse\\s+of\\s+the\\s+black\\s+pearl',
      'dead\\s+man.*chest',
      'at\\s+world.*end',
      'stranger\\s+tides',
      'dead\\s+men\\s+tell\\s+no\\s+tales',
    ],
    tmdbCollections: [295],
  },
  {
    name: 'Toy Story',
    patterns: [
      'toy\\s+story',
      'lightyear',
    ],
    tmdbCollections: [10194],
  },
  {
    name: 'The Expanse',
    patterns: [
      'expanse',
    ],
  },
  {
    name: 'Battlestar Galactica',
    patterns: [
      'battlestar\\s+galactica',
      'bsg',
      'caprica',
    ],
  },
  {
    name: 'Doctor Who',
    patterns: [
      'doctor\\s+who',
      'torchwood',
    ],
  },
  {
    name: 'Dune',
    patterns: [
      'dune',
      'arrakis',
    ],
    tmdbCollections: [726871],
  },
];

/** Compiled franchise patterns for efficient matching */
interface CompiledFranchise {
  config: FranchiseConfig;
  patterns: RegExp[];
}

/** Compile franchise patterns into RegExp objects */
export function compileFranchises(franchises: FranchiseConfig[]): CompiledFranchise[] {
  return franchises.map((config) => ({
    config,
    patterns: config.patterns.map((p) => new RegExp(p, 'i')),
  }));
}

/** Check if a title matches any franchise */
export function matchFranchise(
  title: string,
  compiledFranchises: CompiledFranchise[]
): FranchiseConfig | null {
  for (const { config, patterns } of compiledFranchises) {
    for (const pattern of patterns) {
      if (pattern.test(title)) {
        return config;
      }
    }
  }
  return null;
}

/** Get all matching franchises for a title (may match multiple) */
export function matchAllFranchises(
  title: string,
  compiledFranchises: CompiledFranchise[]
): FranchiseConfig[] {
  const matches: FranchiseConfig[] = [];
  for (const { config, patterns } of compiledFranchises) {
    for (const pattern of patterns) {
      if (pattern.test(title)) {
        matches.push(config);
        break; // Only add each franchise once
      }
    }
  }
  return matches;
}

/** Get all TMDB collection IDs from franchises */
export function getAllFranchiseCollectionIds(franchises: FranchiseConfig[]): number[] {
  const ids = new Set<number>();
  for (const franchise of franchises) {
    if (franchise.tmdbCollections) {
      for (const id of franchise.tmdbCollections) {
        ids.add(id);
      }
    }
  }
  return Array.from(ids);
}

/** Get all TMDB list IDs from franchises */
export function getAllFranchiseListIds(franchises: FranchiseConfig[]): number[] {
  const ids = new Set<number>();
  for (const franchise of franchises) {
    if (franchise.tmdbLists) {
      for (const id of franchise.tmdbLists) {
        ids.add(id);
      }
    }
  }
  return Array.from(ids);
}


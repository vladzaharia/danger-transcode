/**
 * Transcode List Processor for danger-transcode
 * Parses and processes transcode list files for selective transcoding
 * Uses profile-based organization for cleaner configuration
 * Supports JSONC (JSON with comments)
 */

import { parse as parseJsonc } from '@std/jsonc';
import { TranscodeListSchema } from './schemas.ts';
import type {
  TranscodeList,
  ResolvedTranscodeItem,
  ProcessedTranscodeItem,
  Config,
  ProfileSettings,
  MediaQuery,
} from './types.ts';
import { matchMedia, buildMediaIndex } from './media-matcher.ts';
import { getLogger } from './logger.ts';
import { ZodError } from 'zod';

const logger = getLogger().child('transcode-list');

//═══════════════════════════════════════════════════════════════════════════════
// LIST LOADING AND VALIDATION
//═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate that all profile references in media exist in profiles
 */
function validateProfileReferences(list: TranscodeList): void {
  const profileNames = new Set(Object.keys(list.profiles));
  const invalidRefs: string[] = [];

  for (const profileName of Object.keys(list.media)) {
    if (!profileNames.has(profileName)) {
      invalidRefs.push(profileName);
    }
  }

  if (invalidRefs.length > 0) {
    throw new Error(
      `Invalid profile reference(s) in media: ${invalidRefs.join(', ')}\n` +
        `Available profiles: ${[...profileNames].join(', ')}`,
    );
  }
}

/**
 * Load and validate a transcode list from a JSON/JSONC file
 * Supports comments in the file for better documentation
 */
export async function loadTranscodeList(filePath: string): Promise<TranscodeList> {
  logger.info(`Loading transcode list from: ${filePath}`);

  try {
    const content = await Deno.readTextFile(filePath);
    // Use JSONC parser to support comments in transcode list files
    const data = parseJsonc(content);

    // Validate with Zod schema
    const list = TranscodeListSchema.parse(data);

    // Validate profile references
    validateProfileReferences(list);

    const totalItems = Object.values(list.media).reduce((sum, items) => sum + items.length, 0);
    logger.info(
      `Loaded transcode list: ${Object.keys(list.profiles).length} profiles, ${totalItems} items`,
    );
    return list;
  } catch (error) {
    if (error instanceof ZodError) {
      const messages = error.errors.map((err) => {
        const path = err.path.join('.');
        return path ? `  ${path}: ${err.message}` : `  ${err.message}`;
      });
      throw new Error(`Invalid transcode list format:\n${messages.join('\n')}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSONC in transcode list: ${error.message}`);
    }
    throw error;
  }
}

//═══════════════════════════════════════════════════════════════════════════════
// PROFILE FLATTENING
//═══════════════════════════════════════════════════════════════════════════════

/**
 * Merge profile settings with media query overrides
 * Media query values take precedence over profile values
 */
function mergeProfileAndQuery(
  profileName: string,
  profile: ProfileSettings,
  query: MediaQuery,
): ResolvedTranscodeItem {
  return {
    query: query.query,
    library: query.library ?? profile.library ?? 'both',
    maxHeight: query.maxHeight ?? profile.maxHeight,
    bitrate: query.bitrate ?? profile.bitrate,
    inPlace: query.inPlace ?? profile.inPlace,
    outputDir: query.outputDir ?? profile.outputDir,
    priority: query.priority ?? profile.priority ?? 0,
    seasons: query.seasons,
    episodes: query.episodes,
    profileName,
  };
}

/**
 * Flatten profiles and media queries into a sorted list of resolved items
 * Higher priority items come first
 */
export function flattenProfilesToItems(list: TranscodeList): ResolvedTranscodeItem[] {
  const items: ResolvedTranscodeItem[] = [];

  for (const [profileName, queries] of Object.entries(list.media)) {
    const profile = list.profiles[profileName];

    for (const query of queries) {
      items.push(mergeProfileAndQuery(profileName, profile, query));
    }
  }

  // Sort by priority (higher first)
  items.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  return items;
}

//═══════════════════════════════════════════════════════════════════════════════
// LIST PROCESSING
//═══════════════════════════════════════════════════════════════════════════════

/**
 * Process a transcode list against the media index
 * Returns processed items with matched media entries
 */
export async function processTranscodeList(
  list: TranscodeList,
  config: Config,
): Promise<ProcessedTranscodeItem[]> {
  // Build media index from configured directories
  const index = await buildMediaIndex(config.mediaDirs);

  // Flatten profiles into resolved items
  const resolvedItems = flattenProfilesToItems(list);
  const processed: ProcessedTranscodeItem[] = [];

  for (const item of resolvedItems) {
    // Match against media index
    const matches = matchMedia(index, item.query, item.library);

    if (matches.length === 0) {
      logger.warn(`[${item.profileName}] No matches found for query: "${item.query}"`);
      continue;
    }

    logger.info(
      `[${item.profileName}] Query "${item.query}" matched ${matches.length} item(s): ` +
        matches.map((m) => m.entry.originalName).join(', '),
    );

    processed.push({
      originalQuery: item.query,
      profileName: item.profileName,
      matches,
      overrides: {
        inPlace: item.inPlace,
        outputDir: item.outputDir,
        maxHeight: item.maxHeight,
        bitrate: item.bitrate,
      },
    });
  }

  return processed;
}

/**
 * Get all file paths from processed transcode items
 * Expands directories to individual video files
 */
export async function getFilesFromProcessedItems(
  items: ProcessedTranscodeItem[],
  config: Config,
): Promise<Map<string, ProcessedTranscodeItem>> {
  const fileMap = new Map<string, ProcessedTranscodeItem>();

  for (const item of items) {
    for (const match of item.matches) {
      const mediaPath = match.entry.path;

      // Check if it's a directory (show/movie folder) or file
      try {
        const stat = await Deno.stat(mediaPath);

        if (stat.isDirectory) {
          // Walk directory for video files
          await walkForVideoFiles(mediaPath, config.videoExtensions, (filePath) => {
            // Don't overwrite if already in map (earlier items have priority)
            if (!fileMap.has(filePath)) {
              fileMap.set(filePath, item);
            }
          });
        } else if (stat.isFile) {
          // Single file
          if (!fileMap.has(mediaPath)) {
            fileMap.set(mediaPath, item);
          }
        }
      } catch (error) {
        logger.warn(`Failed to access path ${mediaPath}: ${error}`);
      }
    }
  }

  return fileMap;
}

/**
 * Walk a directory recursively for video files
 */
async function walkForVideoFiles(
  dir: string,
  extensions: string[],
  callback: (path: string) => void,
): Promise<void> {
  const extSet = new Set(extensions.map((e) => e.toLowerCase()));

  async function walk(currentDir: string): Promise<void> {
    try {
      for await (const entry of Deno.readDir(currentDir)) {
        const fullPath = `${currentDir}/${entry.name}`;

        if (entry.isDirectory) {
          await walk(fullPath);
        } else if (entry.isFile) {
          const ext = '.' + entry.name.split('.').pop()?.toLowerCase();
          if (extSet.has(ext)) {
            callback(fullPath);
          }
        }
      }
    } catch {
      // Directory not accessible
    }
  }

  await walk(dir);
}


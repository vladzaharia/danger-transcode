/**
 * Subtitle Handler
 * Finds and copies subtitle files alongside media
 */

import { join, dirname, basename, extname } from 'https://deno.land/std@0.224.0/path/mod.ts';

/** Supported subtitle extensions */
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.ass', '.ssa', '.sub', '.idx', '.vtt', '.sup']);

/** Language code patterns in subtitle filenames */
const LANGUAGE_PATTERNS = [
  /\.([a-z]{2,3})\.(?:srt|ass|ssa|sub|vtt)$/i,  // .en.srt, .eng.srt
  /\.([a-z]{2,3})(?:_[a-z]{2})?\.(?:srt|ass|ssa|sub|vtt)$/i,  // .en_US.srt
  /\[([a-z]{2,3})\]\.(?:srt|ass|ssa|sub|vtt)$/i,  // [en].srt
  /\.(?:forced|sdh|cc|hi)\.([a-z]{2,3})\.(?:srt|ass|ssa|sub|vtt)$/i,  // .forced.en.srt
];

/** Common language codes */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  eng: 'English',
  es: 'Spanish',
  spa: 'Spanish',
  fr: 'French',
  fra: 'French',
  de: 'German',
  deu: 'German',
  ger: 'German',
  it: 'Italian',
  ita: 'Italian',
  pt: 'Portuguese',
  por: 'Portuguese',
  ru: 'Russian',
  rus: 'Russian',
  ja: 'Japanese',
  jpn: 'Japanese',
  ko: 'Korean',
  kor: 'Korean',
  zh: 'Chinese',
  zho: 'Chinese',
  chi: 'Chinese',
  ar: 'Arabic',
  ara: 'Arabic',
  nl: 'Dutch',
  nld: 'Dutch',
  dut: 'Dutch',
  pl: 'Polish',
  pol: 'Polish',
  sv: 'Swedish',
  swe: 'Swedish',
  no: 'Norwegian',
  nor: 'Norwegian',
  da: 'Danish',
  dan: 'Danish',
  fi: 'Finnish',
  fin: 'Finnish',
};

/** Subtitle file info */
export interface SubtitleInfo {
  path: string;
  filename: string;
  extension: string;
  language?: string;
  languageName?: string;
  isForced?: boolean;
  isSDH?: boolean;
}

/** Extract language from subtitle filename */
function extractLanguage(filename: string): { code?: string; isForced?: boolean; isSDH?: boolean } {
  const lowerName = filename.toLowerCase();
  const isForced = lowerName.includes('.forced') || lowerName.includes('_forced');
  const isSDH = lowerName.includes('.sdh') || lowerName.includes('.cc') || lowerName.includes('.hi');

  for (const pattern of LANGUAGE_PATTERNS) {
    const match = filename.match(pattern);
    if (match) {
      return { code: match[1].toLowerCase(), isForced, isSDH };
    }
  }

  return { isForced, isSDH };
}

/** Find subtitle files for a media file */
export async function findSubtitles(mediaPath: string): Promise<SubtitleInfo[]> {
  const subtitles: SubtitleInfo[] = [];
  const dir = dirname(mediaPath);
  const mediaName = basename(mediaPath, extname(mediaPath));

  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile) continue;

      const ext = extname(entry.name).toLowerCase();
      if (!SUBTITLE_EXTENSIONS.has(ext)) continue;

      // Check if subtitle matches media file
      const subBaseName = basename(entry.name, ext);

      // Match patterns:
      // - Exact match: Movie.srt for Movie.mkv
      // - Language suffix: Movie.en.srt for Movie.mkv
      // - Various naming conventions
      if (
        subBaseName === mediaName ||
        subBaseName.startsWith(mediaName + '.') ||
        subBaseName.startsWith(mediaName + '_') ||
        subBaseName.startsWith(mediaName + ' ')
      ) {
        const fullPath = join(dir, entry.name);
        const { code, isForced, isSDH } = extractLanguage(entry.name);

        subtitles.push({
          path: fullPath,
          filename: entry.name,
          extension: ext,
          language: code,
          languageName: code ? LANGUAGE_NAMES[code] : undefined,
          isForced,
          isSDH,
        });
      }
    }
  } catch (error) {
    console.warn(`Error scanning for subtitles in ${dir}:`, error);
  }

  return subtitles;
}

/** Copy subtitle file to destination */
export async function copySubtitle(
  subtitle: SubtitleInfo,
  destMediaPath: string
): Promise<string> {
  const destDir = dirname(destMediaPath);
  const destMediaName = basename(destMediaPath, extname(destMediaPath));

  // Build destination filename
  let destFilename = destMediaName;
  if (subtitle.language) {
    destFilename += `.${subtitle.language}`;
  }
  if (subtitle.isForced) {
    destFilename += '.forced';
  }
  if (subtitle.isSDH) {
    destFilename += '.sdh';
  }
  destFilename += subtitle.extension;

  const destPath = join(destDir, destFilename);

  await Deno.copyFile(subtitle.path, destPath);
  return destPath;
}

/** Copy all subtitles for a media file */
export async function copyAllSubtitles(
  mediaPath: string,
  destMediaPath: string
): Promise<string[]> {
  const subtitles = await findSubtitles(mediaPath);
  const copiedPaths: string[] = [];

  for (const subtitle of subtitles) {
    try {
      const destPath = await copySubtitle(subtitle, destMediaPath);
      copiedPaths.push(destPath);
    } catch (error) {
      console.warn(`Failed to copy subtitle ${subtitle.path}:`, error);
    }
  }

  return copiedPaths;
}


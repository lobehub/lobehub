import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { VerifyEvidenceChapter } from '@lobechat/const/verify';
import { MAX_VERIFY_EVIDENCE_CHAPTERS, readEvidenceChapters } from '@lobechat/const/verify';

import { log } from '../../../utils/logger';
import { firstString, objectValue } from './values';

export type EvidenceType =
  'audio' | 'dom_snapshot' | 'gif' | 'markdown' | 'screenshot' | 'text' | 'transcript' | 'video';

export const INLINE_TEXT_EVIDENCE_LIMIT = 5000;
export const INLINE_TEXT_EVIDENCE_TYPES = new Set<EvidenceType>([
  'dom_snapshot',
  'markdown',
  'text',
  'transcript',
]);

/** Pick an evidence medium from a file extension. */
export function evidenceTypeForFile(file: string): EvidenceType {
  const ext = path.extname(file).toLowerCase().slice(1);
  if (ext === 'gif') return 'gif';
  if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'bmp'].includes(ext)) return 'screenshot';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  // Audio before the text fallback: an unrecognized binary used to land on
  // `text`, publishing a TTS clip as an unreadable, unplayable blob.
  if (
    ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'aiff', 'aif', 'wma'].includes(ext)
  )
    return 'audio';
  if (['html', 'htm'].includes(ext)) return 'dom_snapshot';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  return 'text';
}

export function inlineTextEvidenceForFile(
  file: string,
  type: EvidenceType | string,
): string | undefined {
  if (!INLINE_TEXT_EVIDENCE_TYPES.has(type as EvidenceType)) return undefined;

  try {
    const buffer = readFileSync(file);
    if (buffer.includes(0)) return undefined;

    const content = buffer.toString('utf8');
    return content.length > 0 && content.length < INLINE_TEXT_EVIDENCE_LIMIT ? content : undefined;
  } catch {
    return undefined;
  }
}

/** Normalize a case's `evidence` field (string | string[] | {path}[]) to path strings. */
export interface ReportEvidenceInput {
  /** Video only: agent markers on the timeline — steps it took, claims it checked, flags it raised. */
  chapters?: VerifyEvidenceChapter[];
  comparison?: {
    id: string;
    label?: string;
    layout?: 'horizontal' | 'vertical';
    role: 'after' | 'before';
  };
  description?: string;
  path: string;
}

export function reportEvidence(evidence: unknown): ReportEvidenceInput[] {
  if (!evidence) return [];
  const arr = Array.isArray(evidence) ? evidence : [evidence];
  return arr
    .map((e): ReportEvidenceInput | null => {
      if (typeof e === 'string') return { path: e };
      const value = objectValue(e);
      const evidencePath = value && firstString(value.path, value.file);
      if (!evidencePath) return null;
      const comparison = objectValue(value.comparison);
      const role = comparison?.role;
      const id = firstString(comparison?.id);
      // The report viewer pairs on `id` and drops any comparison lacking one, so
      // an id-less half could never render side by side. Warn rather than upload
      // a comparison that is silently downgraded to an ordinary image.
      //
      // Test the raw field, not the parsed object: a comparison written flat
      // (`comparison: "row", role: "before"`) is not an object at all, so keying
      // the warning off `objectValue()` skipped the one shape that most needs
      // it — the author saw a clean ingest and unpaired images on the page.
      // Absent means null/undefined only; `""` / `0` / `false` are malformed
      // values that were written on purpose, so they warn like any other.
      const hasComparison = value.comparison !== undefined && value.comparison !== null;
      if (hasComparison && !(comparison && id && (role === 'before' || role === 'after'))) {
        log.warn(
          `evidence ${evidencePath}: comparison must be an object with a string "id" and role "before"/"after" — ignoring it`,
        );
      }
      const layout = comparison?.layout === 'vertical' ? 'vertical' : undefined;
      return {
        chapters: reportEvidenceChapters(evidencePath, value.chapters),
        comparison:
          id && (role === 'before' || role === 'after')
            ? { id, label: firstString(comparison?.label), layout, role }
            : undefined,
        description: firstString(value.description, value.desc),
        path: evidencePath,
      };
    })
    .filter((item): item is ReportEvidenceInput => item !== null);
}

/**
 * A video's chapters, with every dropped marker named: a marker the reviewer
 * never sees is a claim the agent believes it made, so the author must know.
 */
function reportEvidenceChapters(
  evidencePath: string,
  raw: unknown,
): VerifyEvidenceChapter[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (evidenceTypeForFile(evidencePath) !== 'video') {
    log.warn(`evidence ${evidencePath}: chapters only apply to video evidence — ignoring them`);
    return undefined;
  }
  if (!Array.isArray(raw)) {
    log.warn(`evidence ${evidencePath}: chapters must be an array — ignoring them`);
    return undefined;
  }
  const chapters = readEvidenceChapters(raw) ?? [];
  const dropped = raw.length - chapters.length;
  if (dropped > 0) {
    log.warn(
      `evidence ${evidencePath}: dropped ${dropped} of ${raw.length} chapters — each needs a non-negative "t" (seconds), a "kind" of step/check/flag, a "label" for a step and a "note" for a check or flag`,
    );
  }
  return chapters.length > 0 ? chapters : undefined;
}

/**
 * The metadata bag for one command-line evidence upload: `--metadata` JSON with
 * `--chapters <file>` merged in. Unlike a report ingest, a single upload names
 * its chapters explicitly, so a malformed or misplaced marker is an error to
 * fix before the upload rather than a warning after it.
 */
export function evidenceMetadataFromOptions(options: {
  chapters?: string;
  metadata?: string;
  type?: string;
}): Record<string, unknown> | undefined {
  let metadata: Record<string, unknown> | undefined;
  if (options.metadata) {
    const parsed: unknown = JSON.parse(options.metadata);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('--metadata must be a JSON object');
    metadata = parsed as Record<string, unknown>;
  }
  if (!options.chapters) return metadata;

  if (options.type !== 'video') throw new Error('--chapters only applies to --type video evidence');
  const raw: unknown = JSON.parse(readFileSync(options.chapters, 'utf8'));
  // Accept the bare array video-chapters.md writes, or a `{ chapters }` bag.
  const list =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as { chapters?: unknown }).chapters
      : raw;
  if (!Array.isArray(list)) throw new Error(`${options.chapters}: chapters must be a JSON array`);
  if (list.length > MAX_VERIFY_EVIDENCE_CHAPTERS)
    throw new Error(
      `${options.chapters}: ${list.length} chapters exceed the limit of ${MAX_VERIFY_EVIDENCE_CHAPTERS} per video`,
    );
  const chapters = readEvidenceChapters(list) ?? [];
  if (chapters.length !== list.length)
    throw new Error(
      `${options.chapters}: ${list.length - chapters.length} of ${list.length} chapters are malformed — each needs a non-negative "t" (seconds), a "kind" of step/check/flag, a "label" for a step and a "note" for a check or flag`,
    );
  return { ...metadata, chapters };
}

/** Keep file identity when small text artifacts are stored inline. */
export function evidenceDescriptionForFile(
  description?: string,
  file?: string,
): string | undefined {
  return description?.trim() || (file ? path.basename(file) : undefined);
}

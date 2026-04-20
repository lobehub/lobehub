import type {
  MarkdownPatchDeleteHunk,
  MarkdownPatchDeleteLinesHunk,
  MarkdownPatchErrorDetail,
  MarkdownPatchHunk,
  MarkdownPatchInsertAtHunk,
  MarkdownPatchReplaceHunk,
  MarkdownPatchReplaceLinesHunk,
  MarkdownPatchResult,
} from './types';

const countOccurrences = (source: string, needle: string): number => {
  if (!needle) return 0;

  let count = 0;
  let from = 0;
  while (true) {
    const idx = source.indexOf(needle, from);
    if (idx === -1) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
};

const getMode = (hunk: MarkdownPatchHunk) => hunk.mode ?? 'replace';

const isLineBased = (
  hunk: MarkdownPatchHunk,
): hunk is
  | MarkdownPatchDeleteLinesHunk
  | MarkdownPatchInsertAtHunk
  | MarkdownPatchReplaceLinesHunk =>
  getMode(hunk) === 'deleteLines' ||
  getMode(hunk) === 'insertAt' ||
  getMode(hunk) === 'replaceLines';

const applyContentHunk = (
  source: string,
  hunk: MarkdownPatchReplaceHunk | MarkdownPatchDeleteHunk,
  hunkIndex: number,
): { content: string; count: number } | MarkdownPatchErrorDetail => {
  if (!hunk.search) {
    return { code: 'EMPTY_SEARCH', hunkIndex };
  }

  const occurrences = countOccurrences(source, hunk.search);

  if (occurrences === 0) {
    return { code: 'HUNK_NOT_FOUND', hunkIndex, search: hunk.search };
  }

  if (occurrences > 1 && !hunk.replaceAll) {
    return { code: 'HUNK_AMBIGUOUS', hunkIndex, occurrences };
  }

  const replacement = getMode(hunk) === 'delete' ? '' : (hunk as MarkdownPatchReplaceHunk).replace;

  const next = hunk.replaceAll
    ? source.split(hunk.search).join(replacement)
    : source.replace(hunk.search, replacement);

  return { content: next, count: hunk.replaceAll ? occurrences : 1 };
};

// Treat a trailing newline as a line terminator, not as producing an empty
// phantom line. This matches how users count lines in the numbered injected
// document and how editors display them.
const splitLines = (source: string): string[] => {
  if (source === '') return [];
  const normalized = source.endsWith('\n') ? source.slice(0, -1) : source;
  return normalized.split('\n');
};

const joinLines = (lines: string[], preserveTrailingNewline: boolean): string => {
  const joined = lines.join('\n');
  return preserveTrailingNewline && lines.length > 0 ? joined + '\n' : joined;
};

const validateLineHunk = (
  hunk: MarkdownPatchDeleteLinesHunk | MarkdownPatchInsertAtHunk | MarkdownPatchReplaceLinesHunk,
  totalLines: number,
  hunkIndex: number,
): MarkdownPatchErrorDetail | null => {
  if (getMode(hunk) === 'insertAt') {
    const { line } = hunk as MarkdownPatchInsertAtHunk;
    if (!Number.isInteger(line) || line < 1 || line > totalLines + 1) {
      return { code: 'LINE_OUT_OF_RANGE', hunkIndex, line, totalLines };
    }
    return null;
  }

  const { startLine, endLine } = hunk as
    | MarkdownPatchDeleteLinesHunk
    | MarkdownPatchReplaceLinesHunk;

  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    return { code: 'LINE_OUT_OF_RANGE', hunkIndex, totalLines };
  }
  if (endLine < startLine) {
    return { code: 'INVALID_LINE_RANGE', hunkIndex };
  }
  if (startLine < 1 || endLine > totalLines) {
    return { code: 'LINE_OUT_OF_RANGE', hunkIndex, totalLines };
  }
  return null;
};

interface IndexedLineHunk {
  hunk: MarkdownPatchDeleteLinesHunk | MarkdownPatchInsertAtHunk | MarkdownPatchReplaceLinesHunk;
  index: number;
}

const getAnchor = (h: IndexedLineHunk) => {
  const mode = getMode(h.hunk);
  if (mode === 'insertAt') return (h.hunk as MarkdownPatchInsertAtHunk).line;
  return (h.hunk as MarkdownPatchDeleteLinesHunk | MarkdownPatchReplaceLinesHunk).startLine;
};

const rangeOverlapsOrTouches = (a: IndexedLineHunk, b: IndexedLineHunk): boolean => {
  const toRange = (h: IndexedLineHunk): [number, number] => {
    const mode = getMode(h.hunk);
    if (mode === 'insertAt') {
      const l = (h.hunk as MarkdownPatchInsertAtHunk).line;
      return [l, l];
    }
    const r = h.hunk as MarkdownPatchDeleteLinesHunk | MarkdownPatchReplaceLinesHunk;
    return [r.startLine, r.endLine];
  };

  const [aStart, aEnd] = toRange(a);
  const [bStart, bEnd] = toRange(b);

  // insertAt at position N touches the boundary around lines; treat same `line`
  // or boundary overlap with a range as an overlap to keep semantics predictable.
  return aStart <= bEnd && bStart <= aEnd;
};

const applyLineHunk = (
  lines: string[],
  hunk: MarkdownPatchDeleteLinesHunk | MarkdownPatchInsertAtHunk | MarkdownPatchReplaceLinesHunk,
): string[] => {
  const mode = getMode(hunk);

  if (mode === 'insertAt') {
    const { line, content } = hunk as MarkdownPatchInsertAtHunk;
    const inserted = content === '' ? [''] : content.split('\n');
    const next = lines.slice();
    next.splice(line - 1, 0, ...inserted);
    return next;
  }

  const { startLine, endLine } = hunk as
    | MarkdownPatchDeleteLinesHunk
    | MarkdownPatchReplaceLinesHunk;
  const removeCount = endLine - startLine + 1;
  const next = lines.slice();

  if (mode === 'deleteLines') {
    next.splice(startLine - 1, removeCount);
    return next;
  }

  const { content } = hunk as MarkdownPatchReplaceLinesHunk;
  const replacement = content === '' ? [] : content.split('\n');
  next.splice(startLine - 1, removeCount, ...replacement);
  return next;
};

/**
 * Apply a list of hunks to a markdown document.
 *
 * Modes:
 * - `replace` (default): byte-exact SEARCH → REPLACE.
 * - `delete`: byte-exact SEARCH removed from document.
 * - `deleteLines`: remove lines `[startLine, endLine]` (1-based, inclusive).
 * - `insertAt`: insert `content` before `line`; `line = totalLines + 1` appends.
 * - `replaceLines`: replace `[startLine, endLine]` with `content`.
 *
 * Execution order:
 * 1. Content-based hunks (`replace`, `delete`) run in declaration order.
 * 2. Line-based hunks run afterward, sorted by anchor line descending, so
 *    earlier-line hunks are unaffected by shifts caused by later-line hunks.
 * 3. Line-based hunks whose ranges overlap are rejected as `LINE_OVERLAP`.
 *
 * First error aborts the whole patch; no partial application is committed.
 */
export const applyMarkdownPatch = (
  source: string,
  hunks: MarkdownPatchHunk[],
): MarkdownPatchResult => {
  if (!Array.isArray(hunks) || hunks.length === 0) {
    return { error: { code: 'EMPTY_HUNKS', hunkIndex: -1 }, ok: false };
  }

  let current = source;
  let applied = 0;

  const lineHunks: IndexedLineHunk[] = [];

  for (const [hunkIndex, hunk] of hunks.entries()) {
    if (isLineBased(hunk)) {
      lineHunks.push({ hunk, index: hunkIndex });
      continue;
    }

    const result = applyContentHunk(current, hunk, hunkIndex);
    if ('code' in result) {
      return { error: result, ok: false };
    }
    current = result.content;
    applied += result.count;
  }

  if (lineHunks.length === 0) {
    return { applied, content: current, ok: true };
  }

  const sorted = lineHunks.slice().sort((a, b) => getAnchor(b) - getAnchor(a));

  const preserveTrailingNewline = current.endsWith('\n');
  let lines = splitLines(current);
  const baselineTotalLines = lines.length;

  // Validate each hunk against the baseline first, so invalid ranges surface
  // as LINE_OUT_OF_RANGE / INVALID_LINE_RANGE instead of being misreported as
  // LINE_OVERLAP by the overlap check below.
  for (const { hunk, index } of sorted) {
    const error = validateLineHunk(hunk, baselineTotalLines, index);
    if (error) {
      return { error, ok: false };
    }
  }

  for (let i = 0; i < sorted.length - 1; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (rangeOverlapsOrTouches(sorted[i], sorted[j])) {
        return { error: { code: 'LINE_OVERLAP', hunkIndex: sorted[i].index }, ok: false };
      }
    }
  }

  for (const { hunk } of sorted) {
    lines = applyLineHunk(lines, hunk);
    applied += 1;
  }

  return { applied, content: joinLines(lines, preserveTrailingNewline), ok: true };
};

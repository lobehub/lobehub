import { readFile, writeFile } from 'node:fs/promises';

import { createPatch } from 'diff';

import type { EditFileParams, EditFileResult } from '../types';
import { resolveAgainstCwd } from './expandTilde';

/** Cap the diagnosis scan so a stray edit against a huge file stays cheap. */
const DIAGNOSIS_MAX_BYTES = 2_000_000;

const squashWhitespace = (s: string) => s.replaceAll(/\s+/g, ' ').trim();

/**
 * Explain *why* an `old_string` didn't match.
 *
 * A bare "not found" costs the agent a whole extra round trip — re-read the
 * file, re-diff by eye, retry — and at a large context that round trip is
 * ~30-60s of wall clock. Nearly every miss is one of a handful of causes
 * (indentation copied wrong, the text drifted since the last read, the wrong
 * file), and the file content needed to tell them apart is already in hand
 * here. Naming the cause lets the model fix the call instead of investigating
 * it.
 */
const diagnoseMissingSearch = (content: string, search: string): string | undefined => {
  if (content.length > DIAGNOSIS_MAX_BYTES) return;

  const lines = content.split('\n');
  const firstSearchLine = search.split('\n')[0].trim();

  // Same text, different whitespace — by far the most common cause: the model
  // reproduced the block from memory and normalized the indentation.
  const squashedSearch = squashWhitespace(search);
  if (squashedSearch.length > 0 && squashWhitespace(content).includes(squashedSearch)) {
    return 'A block matching it apart from whitespace/indentation IS present. Re-read the exact lines and copy their leading whitespace verbatim.';
  }

  // Same text, different case.
  if (search.length > 0 && content.toLowerCase().includes(search.toLowerCase())) {
    return 'A block matching it apart from letter case IS present. old_string is case-sensitive — copy the text exactly as it appears.';
  }

  // The block starts where expected but diverges partway: point at the anchor
  // so the model re-reads that region rather than the whole file.
  if (firstSearchLine.length > 0) {
    const anchors: number[] = [];
    for (const [index, line] of lines.entries()) {
      if (line.trim() === firstSearchLine) anchors.push(index + 1);
      if (anchors.length >= 5) break;
    }
    if (anchors.length > 0) {
      const where = anchors.map((n) => `L${n}`).join(', ');
      return `Its first line matches at ${where}, but the block diverges after that. Re-read from there and copy the current text.`;
    }
  }

  return 'None of it appears in the file. The content may have changed since you last read it, or this may be the wrong file — read the file before retrying.';
};

/**
 * Line numbers (1-indexed) of every non-overlapping occurrence of `search`,
 * capped — the message only needs enough of them to be actionable.
 */
const findOccurrenceLines = (content: string, search: string, cap: number): number[] => {
  const lines: number[] = [];
  let from = 0;
  let consumedLines = 0;
  let consumedUpTo = 0;

  while (lines.length < cap) {
    const index = content.indexOf(search, from);
    if (index === -1) break;

    // Count newlines incrementally rather than slicing from 0 each time, so a
    // string that occurs thousands of times stays linear in the file size.
    for (let i = consumedUpTo; i < index; i++) if (content[i] === '\n') consumedLines++;
    consumedUpTo = index;

    lines.push(consumedLines + 1);
    from = index + search.length;
  }

  return lines;
};

export async function editLocalFile({
  file_path: rawPath,
  old_string,
  new_string,
  replace_all = false,
  cwd,
}: EditFileParams): Promise<EditFileResult> {
  const filePath = resolveAgainstCwd(rawPath, cwd) ?? rawPath;
  try {
    const content = await readFile(filePath, 'utf8');

    // Resolve the search/replace strings against the file's actual line endings.
    // LLMs almost always emit `\n` even when the on-disk file uses CRLF (the norm
    // on Windows), so a literal match would fail and the edit appears broken. When
    // the raw old_string isn't present but its CRLF-adjusted form is, edit against
    // that — keeping the file's existing line-ending style and producing a minimal
    // diff instead of rewriting every line.
    let search = old_string;
    let replace = new_string;
    if (!content.includes(search) && content.includes('\r\n')) {
      const toCRLF = (s: string) => s.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
      const crlfSearch = toCRLF(search);
      if (content.includes(crlfSearch)) {
        search = crlfSearch;
        replace = toCRLF(replace);
      }
    }

    if (!content.includes(search)) {
      const diagnosis = diagnoseMissingSearch(content, search);
      return {
        error: [`The specified old_string was not found in ${filePath}`, diagnosis]
          .filter(Boolean)
          .join(' '),
        replacements: 0,
        success: false,
      };
    }

    // A single-occurrence edit whose old_string matches in more than one place
    // is ambiguous, and picking the first match silently resolves that
    // ambiguity in a way the caller never sees: the tool reports "Successfully
    // replaced 1 occurrence(s)" while the edit may well have landed on the
    // wrong one. Refuse instead, and say what would make the call unambiguous.
    if (!replace_all) {
      const occurrenceLines = findOccurrenceLines(content, search, 6);
      if (occurrenceLines.length > 1) {
        const shown = occurrenceLines
          .slice(0, 5)
          .map((n) => `L${n}`)
          .join(', ');
        const more = occurrenceLines.length > 5 ? ', …' : '';
        return {
          error: `The specified old_string is not unique in ${filePath} — it matches at ${shown}${more}. Include enough surrounding context to identify the one you mean, or pass replace_all: true to change every occurrence.`,
          replacements: 0,
          success: false,
        };
      }
    }

    let newContent: string;
    let replacements: number;

    if (replace_all) {
      const regex = new RegExp(search.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&'), 'g');
      const matches = content.match(regex);
      replacements = matches ? matches.length : 0;
      newContent = content.replaceAll(search, replace);
    } else {
      const index = content.indexOf(search);
      if (index === -1) {
        return {
          error: `The specified old_string was not found in ${filePath}`,
          replacements: 0,
          success: false,
        };
      }
      newContent = content.slice(0, index) + replace + content.slice(index + search.length);
      replacements = 1;
    }

    await writeFile(filePath, newContent, 'utf8');

    const patch = createPatch(filePath, content, newContent, '', '');
    const diffText = `diff --git a${filePath} b${filePath}\n${patch}`;

    const patchLines = patch.split('\n');
    let linesAdded = 0;
    let linesDeleted = 0;

    for (const line of patchLines) {
      if (line.startsWith('+') && !line.startsWith('+++')) linesAdded++;
      else if (line.startsWith('-') && !line.startsWith('---')) linesDeleted++;
    }

    return { diffText, linesAdded, linesDeleted, replacements, success: true };
  } catch (error) {
    return { error: (error as Error).message, replacements: 0, success: false };
  }
}

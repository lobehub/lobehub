import { readFile, writeFile } from 'node:fs/promises';

import { createPatch } from 'diff';

import type { EditFileParams, EditFileResult } from '../types';
import { resolveAgainstCwd } from './expandTilde';

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
      return {
        error: 'The specified old_string was not found in the file',
        replacements: 0,
        success: false,
      };
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
        return { error: 'Old string not found', replacements: 0, success: false };
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

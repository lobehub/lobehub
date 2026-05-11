import { readFile, writeFile } from 'node:fs/promises';

import { createPatch } from 'diff';

import type { EditFileParams, EditFileResult } from '../types';
import { expandTilde } from './expandTilde';

export async function editLocalFile({
  file_path: rawPath,
  old_string,
  new_string,
  replace_all = false,
}: EditFileParams): Promise<EditFileResult> {
  const filePath = expandTilde(rawPath) ?? rawPath;
  try {
    const content = await readFile(filePath, 'utf8');

    if (!content.includes(old_string)) {
      return {
        error: 'The specified old_string was not found in the file',
        replacements: 0,
        success: false,
      };
    }

    let newContent: string;
    let replacements: number;

    if (replace_all) {
      const regex = new RegExp(old_string.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&'), 'g');
      const matches = content.match(regex);
      replacements = matches ? matches.length : 0;
      newContent = content.replaceAll(old_string, new_string);
    } else {
      const index = content.indexOf(old_string);
      if (index === -1) {
        return { error: 'Old string not found', replacements: 0, success: false };
      }
      newContent = content.slice(0, index) + new_string + content.slice(index + old_string.length);
      replacements = 1;
    }

    await writeFile(filePath, newContent, 'utf8');

    const rawPatch = createPatch(filePath, content, newContent, '', '');
    // createPatch() emits an "Index: …\n===…\n" preamble that makes
    // PatchDiff's getSingularPatch see multiple diff blocks and crash with
    // "Provided patch must include only 1 patch, with 1 diff".
    // Strip the preamble lines (everything before the first "--- ") so the
    // renderer receives a single clean unified-diff block.
    const unifiedLines = rawPatch.split('\n');
    const firstMinusIdx = unifiedLines.findIndex((l) => l.startsWith('--- '));
    const cleanPatch = firstMinusIdx > 0 ? unifiedLines.slice(firstMinusIdx).join('\n') : rawPatch;
    const diffText = `diff --git a/${filePath} b/${filePath}\n${cleanPatch}`;

    const patchLines = rawPatch.split('\n');
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

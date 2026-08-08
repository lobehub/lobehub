import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { run } from './exec';
import { rootDir } from './paths';
import type { FileDiff } from './types';

/** Max diff lines per file printed to stdout; longer diffs go to the temp file only. */
export const STDOUT_DIFF_LINE_LIMIT = 50;

/** Count added/removed lines in a unified diff body. */
export const diffStat = (diff: string): { added: number; removed: number } => {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { added, removed };
};

/** Render per-file diffs for stdout, truncating any diff beyond the line limit. */
export const renderDiffsForStdout = (diffs: FileDiff[], limit = STDOUT_DIFF_LINE_LIMIT): string =>
  diffs
    .map(({ added, diff, file, removed }) => {
      const lines = diff.split('\n').filter(Boolean);
      return lines.length > limit
        ? `${file}\n  (diff ${lines.length} lines > ${limit}, truncated — see full diff file)  +${added} -${removed}`
        : `${file}\n${lines.join('\n')}`;
    })
    .join('\n\n');

/** Snapshot current file contents (missing files are skipped) to diff against after autofix. */
export const snapshot = async (files: string[]): Promise<Map<string, string>> => {
  const entries = await Promise.all(
    files.map(async (file): Promise<[string, string] | null> => {
      try {
        return [file, await readFile(path.join(rootDir(), file), 'utf8')];
      } catch {
        return null;
      }
    }),
  );
  const map = new Map<string, string>();
  for (const entry of entries) if (entry) map.set(entry[0], entry[1]);
  return map;
};

/**
 * Diff each snapshotted file against its post-autofix content via the system
 * `diff` (git diff would mix in the agent's own uncommitted edits).
 */
export const collectAutofixDiffs = async (before: Map<string, string>): Promise<FileDiff[]> => {
  const diffs: FileDiff[] = [];
  const scratchDir = await mkdtemp(path.join(tmpdir(), 'check-orig-'));

  for (const [file, original] of before) {
    const abs = path.join(rootDir(), file);
    let current: string;
    try {
      current = await readFile(abs, 'utf8');
    } catch {
      continue;
    }
    if (current === original) continue;

    const origCopy = path.join(scratchDir, path.basename(file));
    await writeFile(origCopy, original);
    const result = await run(
      'diff',
      ['-u', '-L', `a/${file}`, '-L', `b/${file}`, origCopy, abs],
      rootDir(),
    );
    const { added, removed } = diffStat(result.stdout);
    diffs.push({ added, diff: result.stdout.trim(), file, removed });
  }

  return diffs;
};

/** Write the untruncated combined diff to a temp file and return its path. */
export const writeFullDiff = async (diffs: FileDiff[]): Promise<string> => {
  const diffFile = path.join(tmpdir(), `check-autofix-${Date.now()}.diff`);
  await writeFile(diffFile, diffs.map((entry) => entry.diff).join('\n\n') + '\n');
  return diffFile;
};

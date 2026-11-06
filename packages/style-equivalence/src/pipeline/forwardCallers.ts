import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { FileExtraction } from '../extract';
import type { FilePlan, Side } from '../plan/planFile';

const run = promisify(execFile);

export interface CallerContext {
  extractions: Record<string, Record<Side, FileExtraction>>;
  grep: (word: string) => Promise<string[]>;
  read: (file: string) => string;
}

export const gitGrepWord = (root: string) => async (word: string) => {
  try {
    const { stdout } = await run(
      'git',
      ['-C', root, 'grep', '-l', '-w', '-e', word, '--', '*.ts', '*.tsx'],
      {
        maxBuffer: 64 * 1024 ** 2,
      },
    );
    return stdout.split('\n').filter(Boolean);
  } catch (error) {
    if ((error as { code?: number }).code === 1) return [];
    throw error;
  }
};

export const fileReader = (root: string) => (file: string) =>
  readFileSync(path.join(root, file), 'utf8');

const checked = (file: string, word: string, context: CallerContext) => {
  const extraction = Object.values(context.extractions).find(
    (pair) => pair.head.file === file,
  )?.head;
  if (!extraction) return false;
  const mentions = context.read(file).match(new RegExp(`\\b${word}\\b`, 'g'))?.length ?? 0;
  const bound = extraction.elements
    .flatMap((element) => element.bindings)
    .filter((binding) => binding.prop === word).length;
  return mentions === bound;
};

export const flagUncheckedCallers = async (plans: FilePlan[], context: CallerContext) => {
  for (const plan of plans)
    for (const entry of plan.cases) {
      const word = entry.forwardedParam;
      if (!word) continue;
      const own = context.extractions[plan.file]?.head.file ?? plan.file;
      const files = (await context.grep(word)).filter((file) => file !== own);
      const unchecked = files.filter((file) => !checked(file, word, context));
      if (unchecked.length)
        entry.flags = [...entry.flags, `FORWARDED_CALLER_UNCHECKED:${unchecked.join(',')}`].sort();
    }
};

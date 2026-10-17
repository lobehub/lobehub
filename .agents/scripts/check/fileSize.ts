import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createBaseLocator } from './base';
import { run } from './exec';
import { mountDir, rootDir } from './paths';

export const MAX_FILE_LINES = 800;

const SOURCE_PATTERN = /\.[cm]?[jt]sx?$/;
/**
 * Declarations, default locale tables, and generated code are data or tool
 * output, not hand-written code that splits on a module boundary.
 */
const EXEMPT_PATTERN =
  /\.d\.[cm]?ts$|\.gen\.[cm]?[jt]sx?$|(?:^|\/)generated\/|(?:^|\/)locales\/(?:src\/)?default\//;
const RULE_REFERENCE = '.agents/skills/source-layout/SKILL.md §3';

/** Line count at the merge base; `null` when the file does not exist there. */
interface BaseLines {
  baseRef: string;
  lines: number | null;
}

type ReadBaseLines = (file: string) => Promise<BaseLines | undefined>;
type ReadLines = (file: string) => Promise<number>;

export interface FileSizeFindings {
  /** Advisories for legacy over-limit files that grew; reported without failing the run. */
  advisories: string[];
  /** New files over the limit, or files this change pushed over it; these fail the run. */
  errors: string[];
}

/** Same count as `wc -l`, plus a final line without a trailing newline. */
export const countLines = (content: string) => {
  if (content.length === 0) return 0;
  const newlines = content.split('\n').length - 1;
  return content.endsWith('\n') ? newlines : newlines + 1;
};

const readLines: ReadLines = async (file) =>
  countLines(await readFile(path.join(rootDir(), file), 'utf8'));

const createBaseLinesReader = (): ReadBaseLines => {
  const locate = createBaseLocator();

  return async (file) => {
    const base = await locate(file);
    if (!base) return;

    const result = await run(
      'git',
      ['show', `${base.baseCommit}:${base.basePath}`],
      mountDir(base.mount),
    );

    return {
      baseRef: base.baseRef,
      lines: result.code === 0 ? countLines(result.stdout) : null,
    };
  };
};

/**
 * Enforce the 800-line limit on changed source and test files. Hundreds of
 * legacy files already exceed it, so blocking every touch would stall
 * unrelated fixes: only violations this change creates fail the run, and a
 * legacy file that keeps growing is reported as an advisory.
 */
export const checkFileSizes = async (
  files: string[],
  readCurrentLines: ReadLines = readLines,
  readBaseLines: ReadBaseLines = createBaseLinesReader(),
): Promise<FileSizeFindings> => {
  const findings: FileSizeFindings = { advisories: [], errors: [] };
  const candidates = [
    ...new Set(files.filter((file) => SOURCE_PATTERN.test(file) && !EXEMPT_PATTERN.test(file))),
  ];

  const sizes = await Promise.all(candidates.map((file) => readCurrentLines(file)));
  const oversized = candidates
    .map((file, index) => ({ file, lines: sizes[index] }))
    .filter(({ lines }) => lines > MAX_FILE_LINES);
  const bases = await Promise.all(oversized.map(({ file }) => readBaseLines(file)));

  oversized.forEach(({ file, lines }, index) => {
    const base = bases[index];
    // Without a base the change cannot be told apart from legacy debt.
    if (!base) return;

    if (base.lines === null) {
      findings.errors.push(
        `${file}: new file has ${lines} lines (limit ${MAX_FILE_LINES}, relative to ${base.baseRef}). Split it on a real boundary before committing (${RULE_REFERENCE}).`,
      );
    } else if (base.lines <= MAX_FILE_LINES) {
      findings.errors.push(
        `${file}: grew from ${base.lines} to ${lines} lines, crossing the ${MAX_FILE_LINES}-line limit (relative to ${base.baseRef}). Split it in this change (${RULE_REFERENCE}).`,
      );
    } else if (lines > base.lines) {
      findings.advisories.push(
        `${file}: already over ${MAX_FILE_LINES} lines and grew from ${base.lines} to ${lines} (relative to ${base.baseRef}). Over-limit files must not grow; extract the part this change touches (${RULE_REFERENCE}).`,
      );
    }
  });

  return findings;
};

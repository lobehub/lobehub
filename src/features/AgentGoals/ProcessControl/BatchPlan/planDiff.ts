import { diffLines } from 'diff';

export interface PlanDiffLine {
  kind: 'added' | 'removed' | 'same';
  text: string;
}

/**
 * Line-level difference between two versions of a batch plan. A revision
 * carries the previous plan forward and appends its own section, so the usual
 * result is the earlier text unchanged and the new section added.
 */
export const planDiff = (before = '', after = ''): PlanDiffLine[] =>
  // Both sides end with a newline, or a last line followed by new text would
  // read as changed rather than kept.
  diffLines(`${before.trim()}\n`, `${after.trim()}\n`).flatMap((part) =>
    part.value
      .replace(/\n$/, '')
      .split('\n')
      .map((text) => ({
        kind: part.added
          ? ('added' as const)
          : part.removed
            ? ('removed' as const)
            : ('same' as const),
        text,
      })),
  );

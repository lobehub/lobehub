import { diffLines } from 'diff';

/**
 * Direct textual differences between the baseline and the current body.
 *
 * Line-level blocks are what a reviewer can point at ("this paragraph was
 * replaced"); the analysis prompt receives the same blocks so the model can
 * tell a direct wording change from a dependent clause that did not change.
 */
export interface TextDiffBlock {
  /** Current wording of the block; empty for a pure deletion. */
  after: string;
  /** Baseline wording of the block; empty for a pure insertion. */
  before: string;
  /** Position among the changed blocks, in document order. */
  index: number;
}

export interface TextDiffResult {
  addedChars: number;
  blocks: TextDiffBlock[];
  removedChars: number;
}

const trimBlock = (value: string) => value.replaceAll(/\s+$/g, '');

export const computeTextDiff = (baselineText: string, currentText: string): TextDiffResult => {
  const parts = diffLines(baselineText, currentText);

  const blocks: TextDiffBlock[] = [];
  let pendingRemoved: string[] = [];

  const flushRemoved = () => {
    if (pendingRemoved.length === 0) return;
    blocks.push({ after: '', before: pendingRemoved.join(''), index: blocks.length });
    pendingRemoved = [];
  };

  for (const part of parts) {
    if (part.removed) {
      pendingRemoved.push(part.value);
      continue;
    }
    if (part.added) {
      blocks.push({
        after: part.value,
        before: pendingRemoved.join(''),
        index: blocks.length,
      });
      pendingRemoved = [];
      continue;
    }
    flushRemoved();
  }
  flushRemoved();

  return {
    addedChars: blocks.reduce((total, block) => total + block.after.length, 0),
    blocks: blocks.map(({ after, before, index }) => ({
      after: trimBlock(after),
      before: trimBlock(before),
      index,
    })),
    removedChars: blocks.reduce((total, block) => total + block.before.length, 0),
  };
};

/** The diff in the form the prompt and the UI both read. */
export const formatDiffBlocks = (blocks: TextDiffBlock[], maxChars = 6000): string => {
  const lines: string[] = [];
  let used = 0;

  for (const block of blocks) {
    const removed = block.before
      ? block.before
          .split('\n')
          .filter(Boolean)
          .map((line) => `- ${line}`)
      : [];
    const added = block.after
      ? block.after
          .split('\n')
          .filter(Boolean)
          .map((line) => `+ ${line}`)
      : [];

    for (const line of [...removed, ...added]) {
      if (used + line.length + 1 > maxChars) {
        lines.push('…（差异过长，已截断）');
        return lines.join('\n');
      }
      lines.push(line);
      used += line.length + 1;
    }
  }

  return lines.join('\n');
};

export interface IndentStyle {
  size: number;
  useTabs: boolean;
}

const DEFAULT_INDENT: IndentStyle = { size: 2, useTabs: false };

const SAMPLE_LINE_LIMIT = 400;

const BLOCK_COMMENT_CONTINUATION = /^\s*\*/;

/**
 * Infer a file's own indentation so the editor reports it and the Tab key
 * matches what is already on disk, instead of forcing one project-wide guess.
 *
 * Counts how often each indentation *step* occurs — the difference between one
 * indented line and the previous one — which is what makes a file indented in
 * 4s read as 4 even though its deeper lines sit at 8, 12 and 16 columns.
 */
export const detectIndentStyle = (content: string): IndentStyle => {
  const lines = content.split('\n', SAMPLE_LINE_LIMIT);

  let tabLines = 0;
  let spaceLines = 0;
  const stepCounts = new Map<number, number>();
  let previousWidth = 0;

  for (const line of lines) {
    // A block comment's continuation lines sit one space in to align their
    // asterisks. Counting them buries a 2- or 4-space file under a pile of
    // 1-space steps, so they never reach the histogram.
    if (BLOCK_COMMENT_CONTINUATION.test(line)) continue;

    const indent = /^[\t ]*/.exec(line)?.[0] ?? '';
    // Blank and unindented lines carry no signal, and a line that is only
    // whitespace is usually trailing padding rather than real structure.
    if (!indent || indent.length === line.length) continue;

    if (indent.includes('\t')) {
      tabLines += 1;
      continue;
    }

    spaceLines += 1;
    const step = indent.length - previousWidth;
    previousWidth = indent.length;
    if (step > 0) stepCounts.set(step, (stepCounts.get(step) ?? 0) + 1);
  }

  if (tabLines > spaceLines) return { size: 4, useTabs: true };
  if (spaceLines === 0) return DEFAULT_INDENT;

  let bestStep = 0;
  let bestCount = 0;
  for (const [step, count] of stepCounts) {
    // Ties go to the smaller step: a file indented in 2s also shows plenty of
    // 4-column jumps, but never the other way round.
    if (count > bestCount || (count === bestCount && step < bestStep)) {
      bestStep = step;
      bestCount = count;
    }
  }

  // Anything past 8 is far more likely to be wrapped-argument alignment than a
  // real indent unit.
  if (bestStep < 1 || bestStep > 8) return DEFAULT_INDENT;

  return { size: bestStep, useTabs: false };
};

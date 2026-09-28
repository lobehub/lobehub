import type { TrajectoryNode, TrajectoryResult } from '@lobechat/agent-tracing';
import pc from 'picocolors';

/**
 * One glyph per LLM call, left to right in call order.
 *
 * A different tool route is drawn neutral, not as a warning: the replay asks
 * whether another model gets the job done, and a model that solved the same
 * problem by calling different tools has not done anything wrong. Only a call
 * that never reached the model is red. The pass / fail answer comes from the
 * judge, above.
 */
const GLYPH = { diverged: '○', error: '✕', matched: '●', pending: '·' } as const;

type NodeState = keyof typeof GLYPH;

const stateOf = (node: TrajectoryNode | undefined): NodeState => {
  if (!node) return 'pending';
  if (node.attempt.error) return 'error';
  return node.divergence ? 'diverged' : 'matched';
};

const paint = (state: NodeState): string => {
  const glyph = GLYPH[state];
  if (state === 'matched') return pc.green(glyph);
  if (state === 'diverged') return pc.cyan(glyph);
  if (state === 'error') return pc.red(glyph);
  return pc.dim(glyph);
};

const GROUP = 10;
const PER_ROW = 50;

/**
 * Render the strip as rows of `PER_ROW` glyphs, grouped in tens so a node can
 * be counted off by eye, each row labelled with the call number it starts at.
 */
const stripRows = (states: NodeState[]): string[] => {
  const rows: string[] = [];
  // The call-number gutter only earns its space once the strip wraps.
  const numbered = states.length > PER_ROW;

  for (let start = 0; start < states.length; start += PER_ROW) {
    const slice = states.slice(start, start + PER_ROW);
    const groups: string[] = [];
    for (let at = 0; at < slice.length; at += GROUP) {
      groups.push(
        slice
          .slice(at, at + GROUP)
          .map((state) => paint(state))
          .join(''),
      );
    }
    const gutter = numbered ? `${String(start + 1).padStart(4)}  ` : '';
    rows.push(`  ${gutter}${groups.join(' ')}`);
  }

  return rows;
};

/**
 * Live strip: nodes settle out of order under concurrency, so each one is
 * painted where it belongs and the whole strip is redrawn in place. Falls back
 * to printing nothing until the summary when stdout is not a terminal, so piped
 * or captured output stays free of cursor escapes.
 */
export class TrajectoryStrip {
  private readonly states: NodeState[];
  private readonly live: boolean;
  private drawnRows = 0;

  constructor(totalNodes: number) {
    this.states = Array.from({ length: totalNodes }, () => 'pending' as NodeState);
    this.live = Boolean(process.stdout.isTTY) && totalNodes > 0;
  }

  settle(node: TrajectoryNode) {
    this.states[node.nodeIndex] = stateOf(node);
    this.draw();
  }

  /** Paint the initial all-pending strip so the run's length is visible up front. */
  start() {
    this.draw();
  }

  private draw() {
    if (!this.live) return;

    if (this.drawnRows > 0) {
      process.stdout.write(`\u001B[${this.drawnRows}A\u001B[0J`);
    }

    const rows = stripRows(this.states);
    process.stdout.write(`${rows.join('\n')}\n`);
    this.drawnRows = rows.length;
  }
}

/** Supporting detail for the calls that took another route or never answered. */
const printNodeDetail = (node: TrajectoryNode) => {
  const at = `call ${String(node.nodeIndex + 1).padStart(3)} ${pc.dim(`step ${node.stepIndex}`)}`;

  if (node.attempt.error) {
    console.log(`  ${pc.red(GLYPH.error)} ${at}  ${pc.red(node.attempt.error)}`);
    return;
  }

  const divergence = node.divergence;
  if (!divergence) return;

  console.log(
    `  ${pc.cyan(GLYPH.diverged)} ${at}  ${pc.dim('recorded')} ${divergence.recorded || pc.dim('(final answer)')}` +
      `  ${pc.dim('→ replayed')} ${divergence.replayed || pc.dim('(final answer)')}`,
  );
};

const wrap = (text: string, width: number, indent: string): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(indent + line);

  return lines;
};

export const printTrajectorySummary = (result: TrajectoryResult) => {
  const total = result.nodes.length;
  const rerouted = result.nodes.filter((node) => node.divergence);
  const failed = result.nodes.filter((node) => node.attempt.error);
  const elapsed = result.nodes.reduce((sum, node) => sum + (node.attempt.durationMs ?? 0), 0);

  console.log('');

  // The verdict is the answer the replay was run to get, so it leads.
  if (result.verdict) {
    const { passed, reason, score } = result.verdict;
    const badge = passed ? pc.bold(pc.green('✔ PASS')) : pc.bold(pc.red('✘ FAIL'));
    console.log(`  ${badge}  ${pc.bold(score.toFixed(2))}`);
    if (reason) {
      console.log('');
      for (const line of wrap(reason, 76, '  ')) console.log(pc.dim(line));
    }
  } else {
    console.log(`  ${pc.dim('no verdict — run with a judge model to get pass / fail')}`);
  }

  console.log('');
  console.log(
    pc.dim(
      `  ${total} calls · ${(elapsed / 1000).toFixed(1)}s · ` +
        `${total - rerouted.length - failed.length}/${total} took the recorded tool route`,
    ),
  );

  for (const row of stripRows(result.nodes.map((node) => stateOf(node)))) console.log(row);

  if (rerouted.length > 0 || failed.length > 0) {
    console.log('');
    for (const node of result.nodes) {
      if (node.divergence || node.attempt.error) printNodeDetail(node);
    }
  }
};

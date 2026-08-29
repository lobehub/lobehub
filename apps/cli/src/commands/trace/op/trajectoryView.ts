import type { TrajectoryNode, TrajectoryResult } from '@lobechat/agent-tracing';
import pc from 'picocolors';

const truncate = (text: string, max = 160) => {
  const oneLine = text.replaceAll(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
};

/**
 * One glyph per LLM call, laid out left to right in call order — the shape of
 * the run is the thing you want first, not a scroll of per-node paragraphs.
 *
 * Divergence gets its own colour rather than sharing red with a transport
 * failure: "the model chose different tools here" is the finding the replay
 * exists to surface, while "this call never reached the model" says nothing
 * about the model at all.
 */
const GLYPH = { diverged: '◆', error: '✕', matched: '●', pending: '·' } as const;

type NodeState = keyof typeof GLYPH;

const stateOf = (node: TrajectoryNode | undefined): NodeState => {
  if (!node) return 'pending';
  if (node.attempt.error) return 'error';
  return node.divergence ? 'diverged' : 'matched';
};

const paint = (state: NodeState): string => {
  const glyph = GLYPH[state];
  if (state === 'matched') return pc.green(glyph);
  if (state === 'diverged') return pc.yellow(glyph);
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

/** Detail for the nodes worth reading: the ones that diverged or failed. */
const printNodeDetail = (node: TrajectoryNode) => {
  const at = `${pc.bold(`node ${node.nodeIndex + 1}`)} ${pc.dim(`step ${node.stepIndex}`)}`;

  if (node.attempt.error) {
    console.log(`  ${pc.red(GLYPH.error)} ${at}  ${pc.red(node.attempt.error)}`);
    return;
  }

  const divergence = node.divergence;
  if (!divergence) return;

  console.log(`  ${pc.yellow(GLYPH.diverged)} ${at}  ${pc.dim(divergence.field)}`);
  console.log(pc.dim(`      recorded  ${divergence.recorded || '(final answer)'}`));
  console.log(pc.dim(`      replayed  ${divergence.replayed || '(final answer)'}`));
  if (node.attempt.content) {
    console.log(pc.dim(`      said      ${truncate(node.attempt.content, 120)}`));
  }
};

export const printTrajectorySummary = (result: TrajectoryResult) => {
  const total = result.nodes.length;
  const diverged = result.nodes.filter((node) => node.divergence);
  const failed = result.nodes.filter((node) => node.attempt.error);
  const matched = total - diverged.length - failed.length;

  // Reprint the finished strip: under a TTY this replaces the live one, and
  // without a TTY it is the only time the shape is shown.
  console.log('');
  for (const row of stripRows(result.nodes.map((node) => stateOf(node)))) console.log(row);

  console.log('');
  console.log(
    [
      `  ${pc.green(`${GLYPH.matched} ${matched} matched`)}`,
      diverged.length > 0
        ? pc.yellow(`${GLYPH.diverged} ${diverged.length} different tools`)
        : pc.dim(`${GLYPH.diverged} 0 different tools`),
      failed.length > 0
        ? pc.red(`${GLYPH.error} ${failed.length} no response`)
        : pc.dim(`${GLYPH.error} 0 no response`),
      pc.dim(`· ${total} calls`),
    ].join(pc.dim('   ')),
  );

  if (diverged.length > 0 || failed.length > 0) {
    console.log('');
    for (const node of result.nodes) {
      if (node.divergence || node.attempt.error) printNodeDetail(node);
    }
  }

  if (result.reproduction) {
    const verdict = result.reproduction.passed ? pc.green('PASS') : pc.red('FAIL');
    console.log('');
    console.log(
      `  final answer  ${verdict} ${result.reproduction.score.toFixed(2)} ${pc.dim(
        result.reproduction.reason ?? '',
      )}`,
    );
  }
};

import type { GoalGraphView } from '../goalGraphViewModel';
import { type BatchModel, type BatchRound, reopenedRows } from './batchModel';
import type { LayoutBox } from './layout';

/**
 * Fixed layout of an expanded batch, left to right:
 *
 *   冷启动 (the first round's trials as task cards)
 *     → 第 1 轮 [方案 v1 · 放行闸门 · 分批执行]
 *     → 第 2 轮 [方案 v2 · 放行闸门 · 重开 + 分批执行]  → 第 3 轮 …
 *
 * A round is one container: its plan, its gate and the waves it released (or,
 * as the latest round, still holds). A break at a round's gate feeds the next
 * round — which revises both the plan and the gate — so the rounds read as one
 * repeated unit along a line instead of columns of loose cards. Other decisions
 * inside the batch (a machine gate on one unit) sit under the group their
 * subject runs in.
 *
 * An open batch draws no frame of its own: these pieces sit on the map
 * directly. Boxes are relative to the batch's slot, which the map reserves.
 */

/** Group chrome, as the prototype draws it: 8/10 header, 8·4 body, 6/10 foot. */
export const BATCH_GROUP_HEAD = 38;
export const BATCH_GROUP_FOOT = 30;
export const BATCH_GROUP_PAD = 10;
export const BATCH_PROBE_CARD_HEIGHT = 72;
export const BATCH_PROBE_ROW_GAP = 7;
export const BATCH_SQUARE = 12;
/** Row gap equals column gap, so the waves read as a square grid. */
export const BATCH_SQUARE_GAP = 10;
export const BATCH_ROW_LABEL = 44;

/** A round container's plan row and gate row, between its header and its waves. */
export const BATCH_ROUND_PLAN_ROW = 48;
export const BATCH_ROUND_GATE_ROW = 56;

const GAP_Y = 48;
const COLUMN_GAP = 120;
const PROBES_WIDTH = 440;
const ROUND_WIDTH = 300;
const DECISION = { height: 88, width: 250 };
const DECISION_GAP = 16;

/**
 * `experimentProbe`: the cold start — the first round's trials, not a
 * candidate-answer `experiment`. `round`: one round's plan, gate and waves.
 */
export type BatchGroupKind = 'experimentProbe' | 'round';

export interface BatchGroupSpec {
  box: LayoutBox;
  id: string;
  kind: BatchGroupKind;
  /** The round the group belongs to (1-based). */
  revision: number;
}

/** A link the batch draws between its pieces; it renders as an ordinary map edge. */
export interface BatchEdgeSpec {
  id: string;
  /** `revise`: a round's gate sent the batch back and the next round revised it. */
  label?: 'revise';
  source: string;
  /** `r` → `l`: one stage feeding the next along the row. */
  sourceHandle?: 'r';
  target: string;
  targetHandle?: 'l';
}

export interface BatchLayout {
  /** X of the column links into the batch land on, so the map can line it up under its parent. */
  anchorX: number;
  boxes: Record<string, LayoutBox>;
  edges: BatchEdgeSpec[];
  /** Where links into the batch land: its first piece, top of the column. */
  entryId?: string;
  groups: BatchGroupSpec[];
  height: number;
  /** Real graph nodes the layout places; every other batch member stays off the map. */
  nodeIds: Set<string>;
  width: number;
}

export const batchGroupId = (batchId: string, kind: BatchGroupKind, revision = 1) =>
  kind === 'round' ? `${batchId}::round-${revision}` : `${batchId}::experiment-probe`;

const groupHeight = (body: number) => BATCH_GROUP_HEAD + 8 + body + 4 + BATCH_GROUP_FOOT;

const stack = (count: number, size: number, gap: number) =>
  count > 0 ? count * size + (count - 1) * gap : 0;

export const wavesWidth = (waveSize: number) =>
  Math.max(
    ROUND_WIDTH,
    BATCH_GROUP_PAD * 2 + BATCH_ROW_LABEL + 8 + stack(waveSize, BATCH_SQUARE, BATCH_SQUARE_GAP) + 2,
  );

/** How many square rows a round's container draws: its re-opened rows, then its waves. */
export const roundRows = (model: BatchModel, round: BatchRound) =>
  (round.revision > 1 ? reopenedRows(round.probes, model.waveSize).length : 0) +
  model.waveRounds.filter((owner) => owner === round.revision).length;

export const roundHeight = (rows: number) =>
  BATCH_GROUP_HEAD +
  8 +
  BATCH_ROUND_PLAN_ROW +
  BATCH_ROUND_GATE_ROW +
  (rows ? 8 + stack(rows, BATCH_SQUARE, BATCH_SQUARE_GAP) : 0) +
  4 +
  BATCH_GROUP_FOOT;

export const layoutBatch = (graph: GoalGraphView, model: BatchModel): BatchLayout => {
  const { batchId, rounds } = model;
  const boxes: Record<string, LayoutBox> = {};
  const groups: BatchGroupSpec[] = [];
  const edges: BatchEdgeSpec[] = [];
  const nodeIds = new Set<string>();
  const addGroup = (kind: BatchGroupKind, revision: number, box: LayoutBox) => {
    const id = batchGroupId(batchId, kind, revision);
    groups.push({ box, id, kind, revision });
    boxes[id] = box;
    return id;
  };

  const [first] = rounds;
  const roundW = Math.max(ROUND_WIDTH, wavesWidth(model.waveSize));
  let right = 0;
  let previous: string | undefined;

  // The cold start: the first round's trials, before any plan is proved.
  let probesId: string | undefined;
  if (first.probes.length) {
    const rows = Math.ceil(first.probes.length / 2);
    const height = groupHeight(stack(rows, BATCH_PROBE_CARD_HEIGHT, BATCH_PROBE_ROW_GAP));
    probesId = addGroup('experimentProbe', 1, { height, width: PROBES_WIDTH, x: 0, y: 0 });
    right = PROBES_WIDTH;
    previous = probesId;
  }

  // One container per round, left to right; each break feeds the next round.
  const roundIds = new Map<number, string>();
  for (const round of rounds) {
    const x = right ? right + COLUMN_GAP : 0;
    const id = addGroup('round', round.revision, {
      height: roundHeight(roundRows(model, round)),
      width: roundW,
      x,
      y: 0,
    });
    roundIds.set(round.revision, id);
    if (previous)
      edges.push({
        id: `${batchId}::e-round-${round.revision}`,
        label: round.revision > 1 ? 'revise' : undefined,
        source: previous,
        sourceHandle: 'r',
        target: id,
        targetHandle: 'l',
      });
    previous = id;
    right = x + roundW;
  }

  // Other decisions inside the batch, under the group their subject runs in.
  const groupOfNode = new Map<string, string>();
  for (const probe of first.probes) if (probesId) groupOfNode.set(probe.nodeId, probesId);
  for (const round of rounds.slice(1)) {
    const id = roundIds.get(round.revision);
    if (id) for (const probe of round.probes) groupOfNode.set(probe.nodeId, id);
  }
  const rowBottom = Math.max(0, ...Object.values(boxes).map((box) => box.y + box.height));
  const stacked = new Map<string, number>();
  for (const id of model.decisionIds) {
    const subject = graph.byId[id]?.gateSubjectId;
    const source = (subject && groupOfNode.get(subject)) ?? roundIds.get(rounds.length) ?? probesId;
    if (!source) continue;
    const under = boxes[source];
    const count = stacked.get(source) ?? 0;
    stacked.set(source, count + 1);
    boxes[id] = {
      ...DECISION,
      x: under.x + (under.width - DECISION.width) / 2,
      y: rowBottom + GAP_Y + count * (DECISION.height + DECISION_GAP),
    };
    nodeIds.add(id);
    edges.push({ id: `${batchId}::e-aside-${id}`, source, target: id });
  }

  const bottom = Math.max(...Object.values(boxes).map((box) => box.y + box.height), 0);
  const entry = boxes[probesId ?? roundIds.get(1) ?? ''];
  return {
    anchorX: entry ? entry.x + entry.width / 2 : 0,
    boxes,
    edges,
    entryId: probesId ?? roundIds.get(1),
    groups,
    height: bottom,
    nodeIds,
    width: right,
  };
};

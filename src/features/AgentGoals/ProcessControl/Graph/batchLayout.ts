import type { GoalGraphView } from '../goalGraphViewModel';
import { type BatchModel, type BatchRound, reopenedRows } from './batchModel';
import type { LayoutBox } from './layout';

/**
 * Fixed layout of an expanded batch, left to right:
 *
 *   冷启动 (the first round's trials as task cards)
 *     → ┆第 1 轮: 方案 v1 → 放行闸门 → 分批执行┆
 *     → ┆第 2 轮: 方案 v2 → 放行闸门 → 分批执行 · v2┆ → 第 3 轮 …
 *
 * Plan, gate and waves stay their own nodes — the plan and gate are the real
 * graph nodes, the waves the group a person enters the batch through — and a
 * round is a frame around the three, top to bottom. A break at a round's gate
 * feeds the next round, which revises both the plan and the gate, so the
 * frames repeat along one row. Other decisions inside the batch (a machine gate
 * on one unit) sit under the frame their subject runs in.
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

/** A round frame's label row; its side links leave at half this height. */
export const BATCH_FRAME_HEAD = 38;

const GAP_Y = 48;
const COLUMN_GAP = 120;
const PROBES_WIDTH = 440;
const FRAME_PAD = 16;
/** Room between a round's stacked nodes for the link and its arrow. */
const STACK_GAP = 40;
const CARD = { height: 88, width: 250 };
const DECISION = { height: 88, width: 250 };
const DECISION_GAP = 16;

/**
 * `experimentProbe`: the cold start — the first round's trials, not a
 * candidate-answer `experiment`. `round`: the frame around one round's nodes.
 * `waves`: the units one round re-opened and the roster waves it owns.
 */
export type BatchGroupKind = 'experimentProbe' | 'round' | 'waves';

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
  /** `r` → `l`: one stage feeding the next along the row; none: down a round. */
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
  kind === 'experimentProbe' ? `${batchId}::experiment-probe` : `${batchId}::${kind}-${revision}`;

const groupHeight = (body: number) => BATCH_GROUP_HEAD + 8 + body + 4 + BATCH_GROUP_FOOT;

const stack = (count: number, size: number, gap: number) =>
  count > 0 ? count * size + (count - 1) * gap : 0;

export const wavesWidth = (waveSize: number) =>
  Math.max(
    CARD.width,
    BATCH_GROUP_PAD * 2 + BATCH_ROW_LABEL + 8 + stack(waveSize, BATCH_SQUARE, BATCH_SQUARE_GAP) + 2,
  );

/** How many square rows a round's waves draw: its re-opened rows, then its waves. */
export const roundRows = (model: BatchModel, round: BatchRound) =>
  (round.revision > 1 ? reopenedRows(round.probes, model.waveSize).length : 0) +
  model.waveRounds.filter((owner) => owner === round.revision).length;

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
  const innerW = Math.max(CARD.width, wavesWidth(model.waveSize));
  const frameW = innerW + FRAME_PAD * 2;
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

  // One frame per round, left to right; inside, plan → gate → waves.
  const wavesIds = new Map<number, string>();
  const frameIds = new Map<number, string>();
  for (const round of rounds) {
    const x = right ? right + COLUMN_GAP : 0;
    const left = x + FRAME_PAD;
    let y = BATCH_FRAME_HEAD;
    let above: string | undefined;
    const place = (id: string, box: LayoutBox) => {
      boxes[id] = box;
      if (above) edges.push({ id: `${batchId}::e-${above}->${id}`, source: above, target: id });
      above = id;
      y = box.y + box.height + STACK_GAP;
    };
    for (const id of [round.templateId, round.assayId]) {
      if (!id) continue;
      nodeIds.add(id);
      place(id, { ...CARD, x: left + (innerW - CARD.width) / 2, y });
    }
    const rows = roundRows(model, round);
    const wavesBox = {
      height: groupHeight(stack(rows, BATCH_SQUARE, BATCH_SQUARE_GAP)),
      width: innerW,
      x: left,
      y,
    };
    const wavesId = batchGroupId(batchId, 'waves', round.revision);
    place(wavesId, wavesBox);
    groups.push({ box: wavesBox, id: wavesId, kind: 'waves', revision: round.revision });
    wavesIds.set(round.revision, wavesId);

    const frameId = addGroup('round', round.revision, {
      height: wavesBox.y + wavesBox.height + FRAME_PAD,
      width: frameW,
      x,
      y: 0,
    });
    frameIds.set(round.revision, frameId);
    if (previous)
      edges.push({
        id: `${batchId}::e-round-${round.revision}`,
        label: round.revision > 1 ? 'revise' : undefined,
        source: previous,
        sourceHandle: 'r',
        target: frameId,
        targetHandle: 'l',
      });
    previous = frameId;
    right = x + frameW;
  }

  // Other decisions inside the batch, under the round their subject runs in.
  // Revision 0 stands for the cold start.
  const roundOfNode = new Map<string, number>();
  if (probesId) for (const probe of first.probes) roundOfNode.set(probe.nodeId, 0);
  for (const round of rounds.slice(1))
    for (const probe of round.probes) roundOfNode.set(probe.nodeId, round.revision);
  const rowBottom = Math.max(0, ...Object.values(boxes).map((box) => box.y + box.height));
  const stacked = new Map<number, number>();
  for (const id of model.decisionIds) {
    if (nodeIds.has(id)) continue;
    const subject = graph.byId[id]?.gateSubjectId;
    const revision = (subject ? roundOfNode.get(subject) : undefined) ?? rounds.length;
    const under = boxes[(revision ? frameIds.get(revision) : probesId) ?? ''];
    // The link leaves the bottom of what the subject ran in: the trials, or the waves.
    const source = revision ? wavesIds.get(revision) : probesId;
    if (!under || !source) continue;
    const count = stacked.get(revision) ?? 0;
    stacked.set(revision, count + 1);
    boxes[id] = {
      ...DECISION,
      x: under.x + (under.width - DECISION.width) / 2,
      y: rowBottom + GAP_Y + count * (DECISION.height + DECISION_GAP),
    };
    nodeIds.add(id);
    edges.push({ id: `${batchId}::e-aside-${id}`, source, target: id });
  }

  const bottom = Math.max(...Object.values(boxes).map((box) => box.y + box.height), 0);
  const entry = boxes[probesId ?? frameIds.get(1) ?? ''];
  return {
    anchorX: entry ? entry.x + entry.width / 2 : 0,
    boxes,
    edges,
    entryId: probesId ?? round1Entry(rounds, frameIds),
    groups,
    height: bottom,
    nodeIds,
    width: right,
  };
};

/** Without trials, links into the batch land on its first round's first node. */
const round1Entry = (rounds: BatchRound[], frameIds: Map<number, string>) =>
  rounds[0].templateId ?? rounds[0].assayId ?? frameIds.get(1);

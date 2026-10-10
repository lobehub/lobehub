import type { GoalGraphView } from '../goalGraphViewModel';
import type { BatchModel, BatchRound } from './batchModel';
import type { LayoutBox } from './layout';

/**
 * Fixed layout of an expanded batch, top to bottom like the rest of the map:
 *
 *   实验 (round-1 probes as task cards)
 *     → 方案 v1 → 放行闸门 → 分批执行 (the roster as waves of squares)
 *
 * Each later round is its own column to the right — 方案 vN → 放行闸门 →
 * 分批执行 · 重派 — fed from the group the break surfaced in, so v3 repeats the
 * v1 → v2 loop instead of stacking under it. Other decisions inside the batch
 * (a machine gate on one unit) sit in a column at the far right.
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

const GAP_Y = 48;
const COLUMN_GAP = 120;
const PROBES_WIDTH = 440;
const ROUND_WIDTH = 280;
const TEMPLATE = { height: 88, width: 240 };
const GATE = { height: 88, width: 250 };
const DECISION = { height: 88, width: 250 };
const DECISION_GAP = 16;

/** `experimentProbe`: the first round's trials — not a candidate-answer `experiment`. */
export type BatchGroupKind = 'experimentProbe' | 'waves' | 'redispatch';

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
  source: string;
  /** `r` → `l`: a later round's plan, fed from the side of the group the break surfaced in. */
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
  kind === 'redispatch'
    ? `${batchId}::round-${revision}`
    : `${batchId}::${kind === 'experimentProbe' ? 'experiment-probe' : kind}`;

const groupHeight = (body: number) => BATCH_GROUP_HEAD + 8 + body + 4 + BATCH_GROUP_FOOT;

const stack = (count: number, size: number, gap: number) =>
  count > 0 ? count * size + (count - 1) * gap : 0;

export const wavesWidth = (waveSize: number) =>
  Math.max(
    ROUND_WIDTH,
    BATCH_GROUP_PAD * 2 + BATCH_ROW_LABEL + 8 + stack(waveSize, BATCH_SQUARE, BATCH_SQUARE_GAP) + 2,
  );

export const layoutBatch = (graph: GoalGraphView, model: BatchModel): BatchLayout => {
  const { batchId, rounds } = model;
  const boxes: Record<string, LayoutBox> = {};
  const groups: BatchGroupSpec[] = [];
  const edges: BatchEdgeSpec[] = [];
  const nodeIds = new Set<string>();
  const place = (id: string, box: LayoutBox) => {
    boxes[id] = box;
    if (graph.byId[id]) nodeIds.add(id);
  };
  const addGroup = (kind: BatchGroupKind, revision: number, box: LayoutBox) => {
    const id = batchGroupId(batchId, kind, revision);
    groups.push({ box, id, kind, revision });
    boxes[id] = box;
    return id;
  };

  const first = rounds[0];
  const wavesW = wavesWidth(model.waveSize);
  const columnWidth = Math.max(first.probes.length ? PROBES_WIDTH : 0, wavesW, GATE.width);
  const cx = columnWidth / 2;
  let y = 0;

  // Round 1 — the experiment, its recipe, the gate and the roster.
  let probesId: string | undefined;
  if (first.probes.length) {
    const rows = Math.ceil(first.probes.length / 2);
    const height = groupHeight(stack(rows, BATCH_PROBE_CARD_HEIGHT, BATCH_PROBE_ROW_GAP));
    probesId = addGroup('experimentProbe', 1, {
      height,
      width: PROBES_WIDTH,
      x: cx - PROBES_WIDTH / 2,
      y,
    });
    y += height + GAP_Y;
  }
  const templateY = y;
  let previous = probesId;
  if (first.templateId) {
    place(first.templateId, { ...TEMPLATE, x: cx - TEMPLATE.width / 2, y });
    if (previous)
      edges.push({
        id: `${batchId}::e-template`,
        source: previous,
        target: first.templateId,
      });
    previous = first.templateId;
    y += TEMPLATE.height + GAP_Y;
  }
  const gateY = y;
  if (first.assayId) {
    place(first.assayId, { ...GATE, x: cx - GATE.width / 2, y });
    if (previous)
      edges.push({
        id: `${batchId}::e-gate`,
        source: previous,
        target: first.assayId,
      });
    previous = first.assayId;
    y += GATE.height + GAP_Y;
  }
  const wavesY = y;
  let wavesId: string | undefined;
  if (model.waves.length) {
    const height = groupHeight(stack(model.waves.length, BATCH_SQUARE, BATCH_SQUARE_GAP));
    wavesId = addGroup('waves', 1, { height, width: wavesW, x: cx - wavesW / 2, y });
    if (previous)
      edges.push({
        id: `${batchId}::e-waves`,
        source: previous,
        target: wavesId,
      });
  }

  // Rounds ≥ 2 — one column each, v2 beside v1, v3 beside v2.
  let right = columnWidth;
  const roundGroup = new Map<number, string>([[1, wavesId ?? probesId ?? '']]);
  const sourceOf = (round: BatchRound) => {
    const origin = round.origin;
    if (origin?.kind === 'probes') return probesId;
    if (origin?.kind === 'round') return roundGroup.get(origin.revision);
    return wavesId ?? probesId;
  };
  const roundWidth = Math.max(ROUND_WIDTH, wavesW);
  for (const round of rounds.slice(1)) {
    const x = right + COLUMN_GAP;
    const center = x + roundWidth / 2;
    let chain: string | undefined;
    if (round.templateId) {
      place(round.templateId, { ...TEMPLATE, x: center - TEMPLATE.width / 2, y: templateY });
      const source = sourceOf(round);
      if (source)
        edges.push({
          id: `${batchId}::e-revise-${round.revision}`,
          source,
          sourceHandle: 'r',
          target: round.templateId,
          targetHandle: 'l',
        });
      chain = round.templateId;
    }
    if (round.assayId) {
      place(round.assayId, { ...GATE, x: center - GATE.width / 2, y: gateY });
      if (chain)
        edges.push({
          id: `${batchId}::e-gate-${round.revision}`,
          source: chain,
          target: round.assayId,
        });
      chain = round.assayId;
    }
    if (round.probes.length) {
      // Re-opened units are one batch of their own, capped at the wave size.
      const rows = Math.ceil(round.probes.length / model.waveSize);
      const height = groupHeight(stack(rows, BATCH_SQUARE, BATCH_SQUARE_GAP));
      const id = addGroup('redispatch', round.revision, {
        height,
        width: roundWidth,
        x,
        y: wavesY,
      });
      roundGroup.set(round.revision, id);
      if (chain)
        edges.push({
          id: `${batchId}::e-redispatch-${round.revision}`,
          source: chain,
          target: id,
        });
    }
    right = x + roundWidth;
  }

  // Other decisions inside the batch, beside the group their subject runs in.
  const groupOfNode = new Map<string, string>();
  for (const probe of first.probes) if (probesId) groupOfNode.set(probe.nodeId, probesId);
  for (const round of rounds.slice(1)) {
    const id = roundGroup.get(round.revision);
    if (id) for (const probe of round.probes) groupOfNode.set(probe.nodeId, id);
  }
  if (model.decisionIds.length) {
    const x = right + COLUMN_GAP;
    let dy = 0;
    for (const id of model.decisionIds) {
      place(id, { ...DECISION, x, y: dy });
      const subject = graph.byId[id]?.gateSubjectId;
      const source = (subject && groupOfNode.get(subject)) ?? wavesId ?? probesId;
      if (source)
        edges.push({
          id: `${batchId}::e-aside-${id}`,
          source,
          target: id,
        });
      dy += DECISION.height + DECISION_GAP;
    }
    right = x + DECISION.width;
  }

  const bottom = Math.max(...Object.values(boxes).map((box) => box.y + box.height), 0);
  return {
    anchorX: cx,
    boxes,
    edges,
    entryId: probesId ?? first.templateId ?? wavesId,
    groups,
    height: bottom,
    nodeIds,
    width: right,
  };
};

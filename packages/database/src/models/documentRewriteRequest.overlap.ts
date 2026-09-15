import {
  DOCUMENT_REWRITE_WHOLE_DOCUMENT_TARGET,
  isRecord,
} from './documentRewriteRequest.validation';

/**
 * The persisted target-node array is a useful fallback for rows written by an
 * older server, but only the array inside `selection` is guaranteed to retain
 * document order. Keeping the two values separate lets legacy rows degrade to
 * a conservative block reservation without pretending that a sorted database
 * projection is an ordered range.
 */
export interface DocumentRewriteOverlapCandidate {
  selection?: unknown;
  targetNodeIds?: readonly string[] | null;
}

interface Interval {
  end: number;
  start: number;
}

interface BlockRange {
  intervals: Map<string, Interval>;
  wholeDocument: false;
}

interface WholeDocumentRange {
  wholeDocument: true;
}

type RewriteRange = BlockRange | WholeDocumentRange;

const isNodeId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const readNodeIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const nodeId of value) {
    if (!isNodeId(nodeId) || seen.has(nodeId)) continue;
    seen.add(nodeId);
    ids.push(nodeId);
  }
  return ids;
};

const readCandidateNodeIds = (
  selection: Record<string, unknown> | undefined,
  storedNodeIds: readonly string[] | null | undefined,
): string[] => {
  const projected = readNodeIds(selection?.targetNodeIds);
  if (projected.length > 0) return projected;
  const stored = readNodeIds(storedNodeIds);
  if (stored.length > 0) return stored;
  const startNodeId = isNodeId(selection?.startNodeId) ? selection.startNodeId : undefined;
  const endNodeId = isNodeId(selection?.endNodeId) ? selection.endNodeId : undefined;
  return startNodeId && startNodeId === endNodeId ? [startNodeId] : [];
};

const readOffset = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

const fullBlock = (): Interval => ({ end: Number.POSITIVE_INFINITY, start: 0 });

const addInterval = (intervals: Map<string, Interval>, nodeId: string, interval: Interval) => {
  const current = intervals.get(nodeId);
  if (!current) {
    intervals.set(nodeId, interval);
    return;
  }
  // Duplicated legacy node IDs describe the same block. Unioning their
  // intervals avoids accidentally allowing an overlap because of bad input.
  intervals.set(nodeId, {
    end: Math.max(current.end, interval.end),
    start: Math.min(current.start, interval.start),
  });
};

const createBroadRange = (nodeIds: readonly string[]): RewriteRange => {
  if (nodeIds.includes(DOCUMENT_REWRITE_WHOLE_DOCUMENT_TARGET)) {
    return { wholeDocument: true };
  }
  const intervals = new Map<string, Interval>();
  for (const nodeId of nodeIds) addInterval(intervals, nodeId, fullBlock());
  return { intervals, wholeDocument: false };
};

const rangeFromCandidate = (candidate: DocumentRewriteOverlapCandidate): RewriteRange => {
  const selection = isRecord(candidate.selection) ? candidate.selection : undefined;
  // The selection projection is captured in document order. The denormalized
  // column is canonicalized for indexing and therefore must not be used to
  // infer the order of a cross-block range.
  const orderedNodeIds = readNodeIds(selection?.targetNodeIds);
  const storedNodeIds = readNodeIds(candidate.targetNodeIds);
  const nodeIds = orderedNodeIds.length > 0 ? orderedNodeIds : storedNodeIds;

  if (nodeIds.includes(DOCUMENT_REWRITE_WHOLE_DOCUMENT_TARGET)) {
    return { wholeDocument: true };
  }

  const startNodeId = isNodeId(selection?.startNodeId) ? selection.startNodeId : undefined;
  const endNodeId = isNodeId(selection?.endNodeId) ? selection.endNodeId : undefined;
  const startOffset = readOffset(selection?.startOffset);
  const endOffset = readOffset(selection?.endOffset);

  if (
    nodeIds.length > 0 &&
    ((startNodeId && !nodeIds.includes(startNodeId)) || (endNodeId && !nodeIds.includes(endNodeId)))
  ) {
    // A projection that omits one of its durable endpoints cannot safely be
    // treated as a complete range. Reserve the document until the legacy row
    // is settled rather than allowing a hidden endpoint to overlap.
    return { wholeDocument: true };
  }

  // A same-block endpoint pair is order-independent and remains exact even
  // for legacy rows whose target projection was not persisted.
  if (
    startNodeId &&
    endNodeId &&
    startNodeId === endNodeId &&
    startOffset !== undefined &&
    endOffset !== undefined &&
    (nodeIds.length === 0 || (nodeIds.length === 1 && nodeIds[0] === startNodeId))
  ) {
    const [start, end] =
      startOffset <= endOffset ? [startOffset, endOffset] : [endOffset, startOffset];
    return {
      intervals: new Map([[startNodeId, { end, start }]]),
      wholeDocument: false,
    };
  }

  // Without any projection, distinct endpoints cannot identify the blocks in
  // between them. This is the same conservative whole-document reservation
  // used when the request is first normalized.
  if (nodeIds.length === 0) {
    if (startNodeId && endNodeId && startNodeId !== endNodeId) {
      return { wholeDocument: true };
    }
    const singleNodeId = startNodeId ?? endNodeId;
    if (singleNodeId) return createBroadRange([singleNodeId]);
    return { wholeDocument: true };
  }

  // A multi-block range is exact only when the browser supplied an ordered
  // projection and both endpoint IDs occur in it. For a legacy row with only
  // the sorted database column, reserve its known blocks as whole blocks; this
  // may reject one extra request, but cannot permit a real overlap.
  if (orderedNodeIds.length > 0 && startNodeId && endNodeId && startNodeId !== endNodeId) {
    const startIndex = orderedNodeIds.indexOf(startNodeId);
    const endIndex = orderedNodeIds.indexOf(endNodeId);
    if (startIndex >= 0 && endIndex >= 0) {
      const firstIndex = Math.min(startIndex, endIndex);
      const lastIndex = Math.max(startIndex, endIndex);
      const firstOffset = startIndex === firstIndex ? startOffset : endOffset;
      const lastOffset = startIndex === firstIndex ? endOffset : startOffset;
      const intervals = new Map<string, Interval>();

      for (let index = firstIndex; index <= lastIndex; index += 1) {
        const nodeId = orderedNodeIds[index];
        if (!nodeId) continue;
        if (index === firstIndex) {
          addInterval(intervals, nodeId, {
            end: Number.POSITIVE_INFINITY,
            start: firstOffset ?? 0,
          });
        } else if (index === lastIndex) {
          addInterval(intervals, nodeId, {
            end: lastOffset ?? Number.POSITIVE_INFINITY,
            start: 0,
          });
        } else {
          addInterval(intervals, nodeId, fullBlock());
        }
      }
      return { intervals, wholeDocument: false };
    }
  }

  return createBroadRange(nodeIds);
};

const intervalsOverlap = (left: Interval, right: Interval): boolean =>
  left.start < right.end && right.start < left.end;

/**
 * Check whether two durable rewrite targets overlap.
 *
 * Ranges are half-open (`[startOffset, endOffset)`), so equal boundaries do
 * not conflict. For a cross-block range, the first block is represented by
 * `[startOffset, +Infinity)`, middle blocks by the whole block, and the last
 * block by `[0, endOffset)`. Legacy rows without an ordered projection are
 * compared as whole known blocks, or as whole-document targets when no safe
 * block projection exists.
 */
export const documentRewriteSelectionsOverlap = (
  left: DocumentRewriteOverlapCandidate,
  right: DocumentRewriteOverlapCandidate,
): boolean => {
  const leftSelection = isRecord(left.selection) ? left.selection : undefined;
  const rightSelection = isRecord(right.selection) ? right.selection : undefined;
  const leftNodeTarget =
    leftSelection?.targetKind === 'node' &&
    isNodeId(leftSelection.targetNodeId) &&
    leftSelection.targetNodeId;
  const rightNodeTarget =
    rightSelection?.targetKind === 'node' &&
    isNodeId(rightSelection.targetNodeId) &&
    rightSelection.targetNodeId;
  const leftTargetNodeIds = readCandidateNodeIds(leftSelection, left.targetNodeIds);
  const rightTargetNodeIds = readCandidateNodeIds(rightSelection, right.targetNodeIds);
  // Node targets reserve their entire logical block. This explicit policy
  // keeps a card/code block exclusive even when a legacy range payload uses
  // zero/one offsets, while text-range overlap remains interval-based.
  if (
    (leftNodeTarget &&
      (rightNodeTarget === leftNodeTarget || rightTargetNodeIds.includes(leftNodeTarget))) ||
    (rightNodeTarget && leftTargetNodeIds.includes(rightNodeTarget))
  ) {
    return true;
  }

  const leftRange = rangeFromCandidate(left);
  const rightRange = rangeFromCandidate(right);
  if (leftRange.wholeDocument || rightRange.wholeDocument) return true;

  for (const [nodeId, leftInterval] of leftRange.intervals) {
    const rightInterval = rightRange.intervals.get(nodeId);
    if (rightInterval && intervalsOverlap(leftInterval, rightInterval)) return true;
  }
  return false;
};

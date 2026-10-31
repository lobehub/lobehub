import type {
  AcceptanceCommentThread,
  AcceptanceFrame,
  AcceptanceFrameBoard,
  AcceptanceFrameStage,
  AcceptanceFrameTransition,
  AcceptanceFrameVersion,
} from '@lobechat/types';
import { getAcceptanceFrameStage } from '@lobechat/types';

export interface FrameBoardSummary {
  /** Nodes whose design review ended with a locked baseline. */
  baselined: number;
  /** Nodes whose latest real capture was judged as deviating. */
  deviates: number;
  /** Nodes whose latest real capture was judged as matching — the only delivery pass. */
  matches: number;
  total: number;
}

/**
 * The two phases are counted apart on purpose: a board with every baseline
 * locked and no real capture has finished its review and passed no delivery.
 */
export const summarizeFrameBoard = (board: AcceptanceFrameBoard): FrameBoardSummary => {
  const stages = board.frames.map(getAcceptanceFrameStage);
  return {
    baselined: stages.filter((stage) => stage !== 'reviewing').length,
    deviates: stages.filter((stage) => stage === 'realDeviates').length,
    matches: stages.filter((stage) => stage === 'realMatches').length,
    total: board.frames.length,
  };
};

export const FRAME_STAGE_COLOR: Record<AcceptanceFrameStage, string | undefined> = {
  awaitingRealReview: 'processing',
  baselined: 'gold',
  realDeviates: 'error',
  realMatches: 'success',
  reviewing: undefined,
};

/**
 * Split the transitions into the arrows drawn between neighbouring frames and
 * the rest (loops, skips back), which are listed rather than drawn across the
 * strip — a strip of crossing curves is the free canvas this view avoids.
 */
export const layoutFrameTransitions = (board: AcceptanceFrameBoard) => {
  const between: AcceptanceFrameTransition[][] = board.frames.slice(1).map(() => []);
  const others: AcceptanceFrameTransition[] = [];
  const position = new Map(board.frames.map((frame, index) => [frame.id, index]));
  for (const transition of board.transitions) {
    const from = position.get(transition.fromFrameId);
    const to = position.get(transition.toFrameId);
    if (from !== undefined && to === from + 1) between[from].push(transition);
    else others.push(transition);
  }
  return { between, others };
};

export type FramePinTarget = { captureId: string } | { versionId: string };

/** Root threads pinned on one version or one capture of one frame. */
export const threadsForFrameTarget = (
  threads: AcceptanceCommentThread[],
  frameId: string,
  target: FramePinTarget,
) =>
  threads.filter(({ root }) => {
    const anchor = root.frame;
    if (root.anchorType !== 'frame' || !anchor || anchor.frameId !== frameId) return false;
    return 'versionId' in target
      ? anchor.versionId === target.versionId
      : anchor.captureId === target.captureId;
  });

export const countFramePins = (threads: AcceptanceCommentThread[], frameId: string) =>
  threads.filter(({ root }) => root.anchorType === 'frame' && root.frame?.frameId === frameId)
    .length;

/** One acceptance point per line; blank lines and stray whitespace dropped. */
export const parseCriteriaLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export const baselineVersionOf = (frame: AcceptanceFrame) =>
  frame.baseline
    ? frame.versions.find((version) => version.id === frame.baseline!.versionId)
    : undefined;

/** The criteria the node is judged on: frozen ones once locked, the draft before. */
export const effectiveCriteria = (frame: AcceptanceFrame) =>
  frame.baseline?.criteria ?? frame.criteria;

/**
 * The version a node puts in front of reviewers: the locked baseline once
 * there is one, otherwise the one being previewed, then the current choice,
 * then the first — so a node always opens on a reference, never on nothing.
 */
export const shownVersionOf = (frame: AcceptanceFrame, previewVersionId?: string) =>
  baselineVersionOf(frame) ??
  frame.versions.find((version) => version.id === previewVersionId) ??
  frame.versions.find((version) => version.id === frame.selectedVersionId) ??
  frame.versions[0];

/** `Canvas v3 · members.html`: where a version's reference lives. */
export const canvasRefLabel = (version: AcceptanceFrameVersion) =>
  version.page
    ? `Canvas v${version.canvasVersion} · ${version.page}`
    : `Canvas v${version.canvasVersion}`;

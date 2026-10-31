import { z } from 'zod';

/**
 * The frames board of an acceptance: the design review (pick a version per
 * frame and lock it as the baseline, with its acceptance points) followed by
 * the delivery check (pin a real capture beside each baseline and judge the
 * difference).
 *
 * The order is fixed by the data, not by convention: a node's versions are
 * Canvas pages — a live reference or demo the reviewers click through — and
 * only once one is locked can a screenshot land, as a capture of the running
 * product. A version cannot hold an image at all, so a product screenshot can
 * never pose as the reference it is judged against.
 */
export type AcceptanceFrameSource = 'mock' | 'real';

/**
 * One candidate design of a frame: a page of a Canvas at a pinned version, so
 * the reference a baseline locks cannot drift when the Canvas is edited later.
 * Always a prototype, therefore `mock`.
 */
export interface AcceptanceFrameVersion {
  canvasId: string;
  canvasVersion: number;
  createdAt: string;
  id: string;
  /** Short handle shown on the card, e.g. `A`, `B · compact`. */
  label: string;
  note?: string;
  /** The Canvas page this node shows, e.g. `members.html`; the Canvas entry when absent. */
  page?: string;
  source: 'mock';
}

/**
 * What the shipped UI must show for this node. Written during the design
 * review, frozen with the baseline, and read back when the real capture lands.
 */
export interface AcceptanceFrameCriteria {
  /** Required UI copy: row titles, result text, button labels. */
  copy: string[];
  /** Boundary situations the node must survive. */
  edgeCases: string[];
  /** States the node must render, e.g. `locked / current / working / done / skipped`. */
  states: string[];
}

export interface AcceptanceFrameBaseline {
  /** The acceptance points as they were when the baseline was locked. */
  criteria: AcceptanceFrameCriteria;
  lockedAt: string;
  lockedBy: string | null;
  versionId: string;
}

/** A capture of the running product, pinned beside a baseline node. */
export interface AcceptanceFrameCapture {
  addedBy: string | null;
  capturedAt: string;
  fileId: string;
  id: string;
  note?: string;
  source: 'real';
}

/**
 * The delivery verdict for one node. Kept apart from the baseline on purpose:
 * a locked prototype only says what was agreed, never that it shipped.
 */
export interface AcceptanceFrameRealReview {
  captureId: string;
  note?: string;
  reviewedAt: string;
  reviewedBy: string | null;
  verdict: 'deviates' | 'matches';
}

export interface AcceptanceFrame {
  baseline?: AcceptanceFrameBaseline | null;
  captures: AcceptanceFrameCapture[];
  /** Draft acceptance points; frozen into `baseline.criteria` on lock. */
  criteria: AcceptanceFrameCriteria;
  description?: string;
  id: string;
  /** Stable author key (`empty`, `sources`, …); republishing matches frames on it. */
  key: string;
  realReview?: AcceptanceFrameRealReview | null;
  /** The version the review currently prefers; the conclusion once locked. */
  selectedVersionId?: string | null;
  title: string;
  versions: AcceptanceFrameVersion[];
}

/** An arrow between two frames, labelled with the event that triggers it. */
export interface AcceptanceFrameTransition {
  fromFrameId: string;
  id: string;
  toFrameId: string;
  trigger: string;
}

export interface AcceptanceFrameBoard {
  description?: string;
  frames: AcceptanceFrame[];
  title: string;
  transitions: AcceptanceFrameTransition[];
  updatedAt: string;
  /** Optimistic-concurrency counter; every write bumps it. */
  version: number;
}

/** Display data the read joins onto a stored file id. */
export interface AcceptanceFrameImage {
  fileHeight: number | null;
  fileUrl: string | null;
  fileWidth: number | null;
}

/** The board as the viewer reads it: every capture file id resolved to a signed URL. */
export interface AcceptanceFrameBoardView extends AcceptanceFrameBoard {
  canEdit: boolean;
  images: Record<string, AcceptanceFrameImage>;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const criteriaList = z.array(text(500)).max(30);

export const acceptanceFrameCriteriaSchema = z.object({
  copy: criteriaList,
  edgeCases: criteriaList,
  states: criteriaList,
});

/**
 * What an author publishes. Frames and transitions are addressed by the
 * author's own keys; the server mints ids and keeps the review state of every
 * frame whose key survives the republish.
 */
export const acceptanceFrameBoardInputSchema = z.object({
  description: z.string().trim().max(2000).optional(),
  frames: z
    .array(
      z.object({
        criteria: acceptanceFrameCriteriaSchema.partial().optional(),
        description: z.string().trim().max(2000).optional(),
        key: z
          .string()
          .trim()
          .regex(/^[\w-]{1,64}$/),
        title: text(120),
        versions: z
          .array(
            z.object({
              canvasId: text(255),
              canvasVersion: z.number().int().positive(),
              label: text(60),
              note: z.string().trim().max(1000).optional(),
              page: z
                .string()
                .trim()
                .regex(/^[\w./-]{1,200}\.html$/i)
                .optional(),
            }),
          )
          .min(1)
          .max(8),
      }),
    )
    .min(1)
    .max(40),
  title: text(200),
  transitions: z.array(z.object({ from: text(64), to: text(64), trigger: text(200) })).max(120),
});

export type AcceptanceFrameBoardInput = z.infer<typeof acceptanceFrameBoardInputSchema>;

/** Review and delivery actions on one frame. */
export const acceptanceFrameOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('selectVersion'), versionId: text(64) }),
  z.object({ criteria: acceptanceFrameCriteriaSchema, type: z.literal('setCriteria') }),
  z.object({ type: z.literal('lockBaseline') }),
  z.object({ type: z.literal('unlockBaseline') }),
  z.object({
    fileId: text(255),
    note: z.string().trim().max(1000).optional(),
    type: z.literal('addCapture'),
  }),
  z.object({ captureId: text(64), type: z.literal('removeCapture') }),
  z.object({
    note: z.string().trim().max(2000).optional(),
    type: z.literal('reviewReal'),
    verdict: z.enum(['deviates', 'matches']),
  }),
  z.object({ type: z.literal('clearRealReview') }),
]);

export type AcceptanceFrameOperation = z.infer<typeof acceptanceFrameOperationSchema>;

/** Where a comment sits on the board: a point on one version or one capture. */
export const acceptanceFrameAnchorSchema = z.object({
  /** The real capture the pin was dropped on; absent for a prototype pin. */
  captureId: z.string().min(1).max(64).optional(),
  frameId: z.string().min(1).max(64),
  /** The Canvas version the pin was dropped on. */
  versionId: z.string().min(1).max(64).optional(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export type AcceptanceFrameAnchor = z.infer<typeof acceptanceFrameAnchorSchema>;

/**
 * Where a node stands, read in two phases that never merge: the design review
 * ends at `baselined`; the delivery check starts only with a real capture.
 */
export type AcceptanceFrameStage =
  'reviewing' | 'baselined' | 'awaitingRealReview' | 'realMatches' | 'realDeviates';

export const getAcceptanceFrameStage = (frame: AcceptanceFrame): AcceptanceFrameStage => {
  if (!frame.baseline) return 'reviewing';
  const capture = frame.captures.at(-1);
  if (!capture) return 'baselined';
  const review = frame.realReview;
  if (!review || review.captureId !== capture.id) return 'awaitingRealReview';
  return review.verdict === 'matches' ? 'realMatches' : 'realDeviates';
};

/** Whether the acceptance points are concrete enough to lock: all three lists filled. */
export const isAcceptanceFrameCriteriaComplete = (criteria: AcceptanceFrameCriteria) =>
  criteria.states.length > 0 && criteria.edgeCases.length > 0 && criteria.copy.length > 0;

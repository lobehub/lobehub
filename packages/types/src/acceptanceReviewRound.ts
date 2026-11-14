import { z } from 'zod';

import { acceptanceReviewAnchorSchema } from './acceptanceReview';

export const acceptanceReviewStatuses = ['draft', 'submitted', 'discarded'] as const;
export type AcceptanceReviewStatus = (typeof acceptanceReviewStatuses)[number];

export const acceptanceReviewPhases = [
  'draft',
  'running',
  'delivered',
  'accepted',
  'closed',
] as const;
export type AcceptanceReviewPhase = (typeof acceptanceReviewPhases)[number];

export const acceptanceReviewMarkKinds = ['region', 'element', 'sketch'] as const;
export type AcceptanceReviewMarkKind = (typeof acceptanceReviewMarkKinds)[number];

const finite = z.number().finite();
const rectSchema = z.object({ height: finite, width: finite, x: finite, y: finite });
export type AcceptanceReviewRect = z.infer<typeof rectSchema>;

const anchorShape = acceptanceReviewAnchorSchema.shape;

interface SketchNodeShape {
  children: SketchNodeShape[];
  rect: AcceptanceReviewRect;
  type: 'avatar' | 'button' | 'card' | 'image' | 'input' | 'text';
}

const sketchNodeSchema: z.ZodType<SketchNodeShape> = z.lazy(() =>
  z.object({
    children: z.array(sketchNodeSchema).max(50),
    rect: rectSchema,
    type: z.enum(['avatar', 'button', 'card', 'image', 'input', 'text']),
  }),
);

export const acceptanceReviewMarkContextSchema = z.object({
  commit: anchorShape.commit,
  context: anchorShape.context,
  env: anchorShape.env,
});
export type AcceptanceReviewMarkContext = z.infer<typeof acceptanceReviewMarkContextSchema>;

export const acceptanceReviewPageMetaSchema = z.object({
  description: z.string().max(500).optional(),
  favicon: z.string().max(2000).optional(),
  lang: z.string().max(35).optional(),
  title: z.string().max(300).optional(),
});
export type AcceptanceReviewPageMeta = z.infer<typeof acceptanceReviewPageMetaSchema>;

export const acceptanceReviewMarkInputSchema = z.object({
  clientId: z.string().trim().min(1).max(255),
  content: z.string().trim().min(1).max(4000),
  context: acceptanceReviewMarkContextSchema.optional(),
  kind: z.enum(acceptanceReviewMarkKinds),
  pageMeta: acceptanceReviewPageMetaSchema.optional(),
  rectDocument: rectSchema,
  rectViewport: rectSchema,
  regionRefs: anchorShape.regionRefs,
  regions: z.array(rectSchema).max(6).optional(),
  routeKey: z.string().max(500),
  scroll: z.object({ x: finite, y: finite }),
  sketch: z.array(sketchNodeSchema).max(50).optional(),
  targets: anchorShape.targets.optional(),
  url: z.string().url().max(2000),
  viewport: z.object({ dpr: z.number().positive(), height: finite, width: finite }),
});
export type AcceptanceReviewMarkInput = z.infer<typeof acceptanceReviewMarkInputSchema>;

export type AcceptanceReviewRegionRefs = NonNullable<AcceptanceReviewMarkInput['regionRefs']>;
export type AcceptanceReviewTargets = NonNullable<AcceptanceReviewMarkInput['targets']>;
export type AcceptanceReviewSketch = NonNullable<AcceptanceReviewMarkInput['sketch']>;

type ReviewScroll = { x: number; y: number };
type ReviewViewport = { dpr: number; height: number; width: number };

export interface AcceptanceReview {
  createdAt: Date;
  id: string;
  lastMarkSeq: number;
  projectId: string | null;
  siteId: string;
  status: AcceptanceReviewStatus;
  submittedAt: Date | null;
  taskId: string | null;
  updatedAt: Date;
  userId: string | null;
  workspaceId: string | null;
}

export interface AcceptanceReviewInsert {
  createdAt?: Date;
  id?: string;
  lastMarkSeq?: number;
  projectId?: string | null;
  siteId: string;
  status?: AcceptanceReviewStatus;
  submittedAt?: Date | null;
  taskId?: string | null;
  updatedAt?: Date;
  userId?: string | null;
  workspaceId?: string | null;
}

export interface AcceptanceReviewMark {
  clientId: string;
  content: string;
  context: AcceptanceReviewMarkContext | null;
  createdAt: Date;
  id: string;
  kind: AcceptanceReviewMarkKind;
  pageMeta: AcceptanceReviewPageMeta | null;
  rectDocument: AcceptanceReviewRect;
  rectViewport: AcceptanceReviewRect;
  regionRefs: AcceptanceReviewRegionRefs | null;
  regions: AcceptanceReviewRect[] | null;
  reviewId: string;
  routeKey: string;
  screenshotFileId: string | null;
  scroll: ReviewScroll;
  seq: number;
  sketch: AcceptanceReviewSketch | null;
  targets: AcceptanceReviewTargets | null;
  updatedAt: Date;
  url: string;
  viewport: ReviewViewport;
}

export interface AcceptanceReviewMarkInsert {
  clientId: string;
  content: string;
  context?: AcceptanceReviewMarkContext | null;
  createdAt?: Date;
  id?: string;
  kind: AcceptanceReviewMarkKind;
  pageMeta?: AcceptanceReviewPageMeta | null;
  rectDocument: AcceptanceReviewRect;
  rectViewport: AcceptanceReviewRect;
  regionRefs?: AcceptanceReviewRegionRefs | null;
  regions?: AcceptanceReviewRect[] | null;
  reviewId: string;
  routeKey: string;
  screenshotFileId?: string | null;
  scroll: ReviewScroll;
  seq: number;
  sketch?: AcceptanceReviewSketch | null;
  targets?: AcceptanceReviewTargets | null;
  updatedAt?: Date;
  url: string;
  viewport: ReviewViewport;
}

export const ACCEPTANCE_REVIEW_MARK_MAX_BYTES = 64 * 1024;

const screenshotSchema = z.object({
  dataUrl: z.string().regex(/^data:image\/(jpeg|webp);base64,/),
});

export const createAcceptanceReviewMarkSchema = acceptanceReviewMarkInputSchema
  .extend({ screenshot: screenshotSchema.optional() })
  .refine(
    ({ screenshot: _screenshot, ...mark }) =>
      JSON.stringify(mark).length <= ACCEPTANCE_REVIEW_MARK_MAX_BYTES,
    { message: 'Mark is too large' },
  );

export const updateAcceptanceReviewMarkSchema = z
  .object({
    content: z.string().trim().min(1).max(4000).optional(),
    rectDocument: rectSchema.optional(),
    rectViewport: rectSchema.optional(),
    regionRefs: anchorShape.regionRefs,
    regions: z.array(rectSchema).max(6).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to update',
  });
export type UpdateAcceptanceReviewMarkInput = z.infer<typeof updateAcceptanceReviewMarkSchema>;

export const submitAcceptanceReviewSchema = z.object({
  agentId: z.string().trim().min(1).max(255).optional(),
  feedback: z.string().trim().max(4000).optional(),
});
export type SubmitAcceptanceReviewInput = z.infer<typeof submitAcceptanceReviewSchema>;

export const acceptanceReviewMarkVerdicts = ['pass', 'not_fixed'] as const;
export type AcceptanceReviewMarkVerdict = (typeof acceptanceReviewMarkVerdicts)[number];

export const acceptanceReviewMarkVerdictSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
  verdict: z.enum(acceptanceReviewMarkVerdicts),
});

export const createAcceptanceReviewReplySchema = z.object({
  clientId: z.string().trim().min(1).max(255),
  content: z.string().trim().min(1).max(4000),
});

export interface AcceptanceReviewUserDto {
  avatar?: string;
  id: string;
  name: string;
}

export interface AcceptanceReviewMarkResult {
  agent?: {
    evidence: { url: string }[];
    summary?: string;
    verdict: 'fail' | 'pass' | 'uncertain';
  };
  human: AcceptanceReviewMarkVerdict | null;
  missing: boolean;
}

export interface AcceptanceReviewMarkDto extends Omit<
  AcceptanceReviewMarkInput,
  'clientId' | 'context'
> {
  clientId: string;
  context?: AcceptanceReviewMarkContext;
  createdAt: string;
  id: string;
  replyCount: number;
  result?: AcceptanceReviewMarkResult;
  screenshot: { url: string } | null;
  seq: number;
}

export interface AcceptanceReviewDto {
  counts: { agentPassed: number; humanPassed: number; marks: number };
  createdAt: string;
  id: string;
  marks?: AcceptanceReviewMarkDto[];
  mine: boolean;
  phase: AcceptanceReviewPhase;
  reportUrl: string | null;
  status: AcceptanceReviewStatus;
  submittedAt: string | null;
  task: { id: string; identifier: string | null; name: string | null } | null;
  user: AcceptanceReviewUserDto;
}

export interface AcceptanceReviewSourceLink {
  reviewId: string;
}

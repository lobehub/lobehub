// Contract for the embeddable review toolbar (`@lobehub/review-sdk`, `src/protocol.ts`).
import { z } from 'zod';

const rectSchema = z.object({
  height: z.number().finite(),
  width: z.number().finite(),
  x: z.number().finite(),
  y: z.number().finite(),
});

export const reviewAnchorSchema = z.object({
  commit: z.string().max(200).optional(),
  context: z
    .record(z.string().max(100), z.union([z.string().max(500), z.number(), z.boolean()]))
    .optional(),
  env: z
    .object({
      consoleErrors: z.array(z.string().max(2000)).max(10),
      userAgent: z.string().max(500),
    })
    .optional(),
  intent: z.enum(['change', 'comment']),
  region: rectSchema.optional(),
  scroll: z.object({ x: z.number().finite(), y: z.number().finite() }),
  targets: z
    .array(
      z.object({
        code: z
          .object({
            chain: z
              .array(
                z.object({
                  file: z.string().max(500).optional(),
                  line: z.number().int().optional(),
                  name: z.string().max(200),
                }),
              )
              .max(5),
            column: z.number().int(),
            file: z.string().max(500),
            line: z.number().int(),
          })
          .optional(),
        label: z.string().max(200),
        rect: rectSchema,
        selector: z.string().max(2000),
        text: z.string().max(200).optional(),
      }),
    )
    .max(8),
  title: z.string().max(300).optional(),
  url: z.string().url().max(2000),
  v: z.literal(1),
  viewport: z.object({
    dpr: z.number().positive(),
    height: z.number().finite(),
    width: z.number().finite(),
  }),
});

export type ReviewAnchor = z.infer<typeof reviewAnchorSchema>;

export const REVIEW_ANCHOR_MAX_BYTES = 32 * 1024;

export const createReviewCommentSchema = z
  .object({
    anchor: reviewAnchorSchema.optional(),
    clientId: z.string().trim().min(1).max(255),
    content: z.string().trim().min(1).max(4000),
    parentId: z.string().trim().min(1).max(64).optional(),
    screenshot: z
      .object({ dataUrl: z.string().regex(/^data:image\/(jpeg|webp);base64,/) })
      .optional(),
  })
  .refine((value) => !(value.parentId && (value.anchor || value.screenshot)), {
    message: 'A reply cannot carry an anchor or a screenshot',
  })
  .refine(
    (value) => !value.anchor || JSON.stringify(value.anchor).length <= REVIEW_ANCHOR_MAX_BYTES,
    {
      message: 'Anchor is too large',
    },
  );

export type CreateReviewCommentInput = z.infer<typeof createReviewCommentSchema>;

export const reviewDecisionSchema = z.object({
  note: z.string().trim().max(2000).optional(),
  verdict: z.enum(['accept', 'send_back']),
});

export interface ReviewUser {
  avatar?: string;
  id: string;
  name: string;
}

export interface ReviewSession {
  acceptance: {
    id: string;
    previewUrl?: string;
    requirement?: string;
    round: number;
    status: string;
    title: string;
    url: string;
  };
  /** `reject` without `decide`: a decider granted this reviewer reject access. */
  can: { comment: boolean; decide: boolean; moderate: boolean; reject: boolean };
  expiresAt: string;
  user: ReviewUser;
}

export interface ReviewComment {
  anchor: ReviewAnchor | null;
  author: ReviewUser;
  clientId?: string;
  content: string;
  createdAt: string;
  id: string;
  mine: boolean;
  parentId: string | null;
  replies: ReviewComment[];
  resolvedAt: string | null;
  round: number | null;
  screenshot: { url: string } | null;
}

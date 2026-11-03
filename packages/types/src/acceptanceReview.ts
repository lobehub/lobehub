// Contract for the embeddable acceptance toolbar (`@lobehub/acceptance-sdk`, `src/protocol.ts`).
import { z } from 'zod';

const rectSchema = z.object({
  height: z.number().finite(),
  width: z.number().finite(),
  x: z.number().finite(),
  y: z.number().finite(),
});

export const acceptanceReviewAnchorSchema = z.object({
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
  regionRefs: z
    .array(
      z
        .object({
          box: rectSchema,
          selector: z.string().max(2000),
          text: z.string().max(200).optional(),
        })
        .nullable(),
    )
    .max(6)
    .optional(),
  route: z.string().max(500).optional(),
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

export type AcceptanceReviewAnchor = z.infer<typeof acceptanceReviewAnchorSchema>;

export const ACCEPTANCE_REVIEW_ANCHOR_MAX_BYTES = 32 * 1024;

export const createAcceptanceReviewCommentSchema = z
  .object({
    anchor: acceptanceReviewAnchorSchema.optional(),
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
    (value) =>
      !value.anchor || JSON.stringify(value.anchor).length <= ACCEPTANCE_REVIEW_ANCHOR_MAX_BYTES,
    {
      message: 'Anchor is too large',
    },
  );

export type CreateAcceptanceReviewCommentInput = z.infer<
  typeof createAcceptanceReviewCommentSchema
>;

export const acceptanceReviewDecisionSchema = z.object({
  note: z.string().trim().max(2000).optional(),
  verdict: z.enum(['accept', 'send_back']),
});

export interface AcceptanceReviewUser {
  avatar?: string;
  id: string;
  name: string;
}

export interface AcceptanceReviewSession {
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
  user: AcceptanceReviewUser;
}

export interface AcceptanceReviewComment {
  anchor: AcceptanceReviewAnchor | null;
  author: AcceptanceReviewUser;
  clientId?: string;
  content: string;
  createdAt: string;
  id: string;
  mine: boolean;
  parentId: string | null;
  replies: AcceptanceReviewComment[];
  resolvedAt: string | null;
  round: number | null;
  screenshot: { url: string } | null;
}

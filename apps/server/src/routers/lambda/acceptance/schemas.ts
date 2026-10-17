import { verifyEvidenceChapterKinds } from '@lobechat/const/verify';
import { z } from 'zod';

/**
 * A reviewer's circled region. On video evidence it also carries the frame
 * (`time.start`) or span (`time.start`–`time.end`) it is about, and optionally
 * quotes the agent chapter it disputes.
 */
const reviewAnnotationSchema = z.object({
  comment: z.string().max(2000).optional(),
  disputes: z
    .object({
      kind: z.enum(verifyEvidenceChapterKinds),
      note: z.string().max(500).optional(),
      t: z.number().min(0),
    })
    .optional(),
  evidenceId: z.string(),
  rect: z.object({
    height: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
  time: z
    .object({ end: z.number().min(0).optional(), start: z.number().min(0) })
    .refine((time) => time.end === undefined || time.end > time.start, {
      message: 'time.end must be after time.start',
    })
    .optional(),
});

export const reviewAnnotationsSchema = z.array(reviewAnnotationSchema).max(20).optional();

import { z } from 'zod';

export interface OnboardingUnderstandingWorkflowPayload {
  mode: 'initial' | 'retry';
  sessionId: string;
  sourceId?: string;
  topicId: string;
  userId: string;
}

export const OnboardingUnderstandingWorkflowPayloadSchema = z
  .object({
    mode: z.enum(['initial', 'retry']),
    sessionId: z.string().min(1).max(512),
    sourceId: z.string().min(1).max(512).optional(),
    topicId: z.string().min(1).max(512),
    userId: z.string().min(1).max(512),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.mode === 'retry' && !payload.sourceId) {
      context.addIssue({
        code: 'custom',
        message: 'sourceId is required in retry mode',
        path: ['sourceId'],
      });
    }
  }) satisfies z.ZodType<OnboardingUnderstandingWorkflowPayload>;

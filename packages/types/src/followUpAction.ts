import { z } from 'zod';

import { type OnboardingPhase, OnboardingPhaseSchema } from './user/agentOnboarding';

export interface FollowUpChip {
  /** Short label shown on the chip (≤40 chars) */
  label: string;
  /** Full message text sent on click (≤200 chars; may equal label) */
  message: string;
}

export type FollowUpHint = { kind: 'onboarding'; phase: OnboardingPhase } | { kind: 'chat' };

export interface FollowUpExtractInput {
  hint?: FollowUpHint;
  messageId: string;
}

export interface FollowUpExtractResult {
  chips: FollowUpChip[];
  messageId: string;
}

export const FollowUpHintSchema = z.union([
  z.object({
    kind: z.literal('onboarding'),
    phase: OnboardingPhaseSchema,
  }),
  z.object({
    kind: z.literal('chat'),
  }),
]);

export const FollowUpExtractInputSchema = z.object({
  messageId: z.string().min(1),
  hint: FollowUpHintSchema.optional(),
});

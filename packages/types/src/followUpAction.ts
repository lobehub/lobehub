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
  topicId: string;
}

export interface FollowUpExtractResult {
  chips: FollowUpChip[];
  /** Resolved server-side id of the assistant message the chips were extracted from. Empty string if no eligible message was found. */
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
  hint: FollowUpHintSchema.optional(),
  topicId: z.string().min(1),
});

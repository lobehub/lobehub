import { z } from 'zod';

export interface UserOnboarding {
  /** Current step number (1-based), for resuming onboarding */
  currentStep?: number;
  /** Timestamp when onboarding was completed (ISO 8601) */
  finishedAt?: string;
  /** Onboarding flow version for future upgrades */
  version: number;
}

export const UserOnboardingSchema = z.object({
  currentStep: z.number().optional(),
  finishedAt: z.string().optional(),
  version: z.number(),
});

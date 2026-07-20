import { z } from 'zod';

const identifierSchema = z.string().trim().min(1).max(512);
const providerIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w-]+$/);

export interface ProcessUnderstandingProvidersPayload {
  providerIds: string[];
  sessionId: string;
  topicId: string;
  userId: string;
}

export interface ProcessCollectedUnderstandingPayload {
  sessionId: string;
  topicId: string;
  userId: string;
}

export const ProcessUnderstandingProvidersPayloadSchema = z
  .object({
    providerIds: z.array(providerIdSchema).min(1).max(16),
    sessionId: identifierSchema,
    topicId: identifierSchema,
    userId: identifierSchema,
  })
  .strict() satisfies z.ZodType<ProcessUnderstandingProvidersPayload>;

export const ProcessCollectedUnderstandingPayloadSchema = z
  .object({
    sessionId: identifierSchema,
    topicId: identifierSchema,
    userId: identifierSchema,
  })
  .strict() satisfies z.ZodType<ProcessCollectedUnderstandingPayload>;

const flowKeyPart = (value: string) => value.replaceAll(/[^\w.-]/g, '_');

export const getUnderstandingProvidersFlowControlKey = (sessionId: string) =>
  `onboarding-understanding.providers.${flowKeyPart(sessionId)}`;

export const getUnderstandingWritingFlowControlKey = (sessionId: string) =>
  `onboarding-understanding.writing.${flowKeyPart(sessionId)}`;

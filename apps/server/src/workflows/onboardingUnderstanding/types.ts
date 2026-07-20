import { z } from 'zod';

const identifierSchema = z.string().trim().min(1).max(512);
const providerIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w-]+$/);

export interface ProcessUnderstandingProvidersPayload {
  providers: UnderstandingProviderAttempt[];
  sessionId: string;
  topicId: string;
  userId: string;
}

export interface UnderstandingProviderAttempt {
  id: string;
  revision: number;
}

export interface ProcessCollectedUnderstandingPayload {
  sessionId: string;
  sourceFingerprint: string;
  topicId: string;
  userId: string;
}

export const ProcessUnderstandingProvidersPayloadSchema = z
  .object({
    providers: z
      .array(
        z
          .object({ id: providerIdSchema, revision: z.number().int().positive().max(1_000_000) })
          .strict(),
      )
      .min(1)
      .max(16)
      .refine(
        (providers) => new Set(providers.map(({ id }) => id)).size === providers.length,
        'Provider attempts must be unique',
      ),
    sessionId: identifierSchema,
    topicId: identifierSchema,
    userId: identifierSchema,
  })
  .strict() satisfies z.ZodType<ProcessUnderstandingProvidersPayload>;

export const ProcessCollectedUnderstandingPayloadSchema = z
  .object({
    sessionId: identifierSchema,
    sourceFingerprint: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^[\w-]+@\d+(,[\w-]+@\d+)*$/),
    topicId: identifierSchema,
    userId: identifierSchema,
  })
  .strict() satisfies z.ZodType<ProcessCollectedUnderstandingPayload>;

const flowKeyPart = (value: string) => value.replaceAll(/[^\w.-]/g, '_');

export const getUnderstandingWritingFlowControlKey = (sessionId: string) =>
  `onboarding-understanding.writing.${flowKeyPart(sessionId)}`;

import { z } from 'zod';

const identifierSchema = z.string().trim().min(1).max(512);
const providerIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w-]+$/);
/** Payload for collecting all selected Understanding providers. */
export interface ProcessUnderstandingProvidersPayload {
  providers: UnderstandingProviderAttempt[];
  /** Language required for the eventual user-visible proposal. */
  responseLanguage: string;
  sessionId: string;
  topicId: string;
  userId: string;
}

/** One provider collection attempt in an Understanding workflow. */
export interface UnderstandingProviderAttempt {
  id: string;
  revision: number;
}

/** Payload for generating an Understanding proposal from collected sources. */
export interface ProcessCollectedUnderstandingPayload {
  /** Language required for every user-visible proposal field. */
  responseLanguage: string;
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
    responseLanguage: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[A-Z]{2,3}(?:-[A-Z0-9]{2,8})*$/i),
    sessionId: identifierSchema,
    topicId: identifierSchema,
    userId: identifierSchema,
  })
  .strict() satisfies z.ZodType<ProcessUnderstandingProvidersPayload>;

export const ProcessCollectedUnderstandingPayloadSchema = z
  .object({
    responseLanguage: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[A-Z]{2,3}(?:-[A-Z0-9]{2,8})*$/i),
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

import { z } from 'zod';

import type { StrictOnly } from './zodStrict';

export const MAX_COLLECTION_COUNT = 1_000_000;
export const MAX_COLLECTION_ERRORS = 16;
export const MAX_DIAGNOSTIC_CODE_LENGTH = 64;
export const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 160;
export const MAX_DIAGNOSTIC_OPERATION_LENGTH = 64;
export const MAX_PROVIDER_ID_LENGTH = 64;
export const MAX_ANALYSIS_DESCRIPTION_LENGTH = 2000;
export const MAX_ANALYSIS_SHORT_TEXT_LENGTH = 256;
export const MAX_PERSONA_CONTENT_LENGTH = 4000;

export type UnderstandingProviderStatus = 'pending' | 'running' | 'completed' | 'failed';

export type UnderstandingWritingStatus = 'running' | 'completed' | 'failed';

export type OnboardingUnderstandingSessionStatus =
  'pending' | 'processing' | 'completed' | 'partial' | 'failed';

export interface OnboardingUnderstandingThreadMarker {
  kind: 'writing';
}

export const OnboardingUnderstandingThreadMarkerSchema = z
  .object({
    kind: z.literal('writing'),
  })
  .strict() satisfies z.ZodType<OnboardingUnderstandingThreadMarker>;

export interface CollectionError {
  code: string;
  message: string;
  operation: string;
  provider: string;
  retryable: boolean;
}

export interface CollectionDiagnostics {
  errors: CollectionError[];
  evidenceCount: number;
  failedCount: number;
  succeededCount: number;
}

export type CollectionDiagnosticsSummary = Omit<CollectionDiagnostics, 'errors'>;

export interface UnderstandingCompositionItem {
  description: string;
  salience: number;
  title: string;
}

export interface UnderstandingComposition {
  identities: UnderstandingCompositionItem[];
  interests: UnderstandingCompositionItem[];
  lifeStyle: UnderstandingCompositionItem[];
  social: UnderstandingCompositionItem[];
  working: UnderstandingCompositionItem[];
}

export interface UnderstandingProfile {
  description: string;
  domains: string[];
  name: string;
  pronoun: string;
  roles: string[];
  summary: string;
  tagline: string;
}

export interface UnderstandingPersonaProposal {
  content: string;
  reasoning: string;
  tagline: string;
}

export interface UnderstandingAnalysis {
  composition: UnderstandingComposition;
  personaProposal: UnderstandingPersonaProposal;
  profile: UnderstandingProfile;
}

export interface UnderstandingProviderState {
  completedAt?: string;
  errors: CollectionError[];
  failedCount: number;
  revision: number;
  status: UnderstandingProviderStatus;
  succeededCount: number;
}

interface UnderstandingWritingStateBase {
  sourceFingerprint: string;
  updatedAt: string;
}

export type UnderstandingWritingState = UnderstandingWritingStateBase &
  (
    | {
        error?: never;
        resultMessageId?: string;
        status: 'running';
      }
    | {
        error?: never;
        resultMessageId: string;
        status: 'completed';
      }
    | {
        error: CollectionError;
        resultMessageId?: string;
        status: 'failed';
      }
  );

export interface OnboardingUnderstandingSession {
  confirmedAt?: string;
  id: string;
  sources: Record<string, UnderstandingProviderState>;
  writing?: UnderstandingWritingState;
}

export interface OnboardingUnderstandingMessageMetadata {
  analysis: UnderstandingAnalysis;
  diagnostics: CollectionDiagnostics;
  kind: 'proposal';
  providers: string[];
  resultId: string;
  sourceFingerprint: string;
}

export interface OnboardingUnderstandingPollingResult {
  id: string;
  proposal?: OnboardingUnderstandingMessageMetadata;
  sources: Record<string, UnderstandingProviderState>;
  status: OnboardingUnderstandingSessionStatus;
  writing?: UnderstandingWritingState;
}

export interface OnboardingUnderstandingTopicInput {
  topicId: string;
}

export interface RetryOnboardingUnderstandingProviderInput extends OnboardingUnderstandingTopicInput {
  providerId: string;
  sessionId: string;
}

export interface ConfirmOnboardingUnderstandingInput extends OnboardingUnderstandingTopicInput {
  resultId: string;
  sessionId: string;
}

export interface ConfirmOnboardingUnderstandingResult {
  confirmed: true;
  personaVersion: number;
  resultId: string;
  sessionId: string;
}

export const CollectionErrorSchema = z
  .object({
    code: z.string().max(MAX_DIAGNOSTIC_CODE_LENGTH),
    message: z.string().max(MAX_DIAGNOSTIC_MESSAGE_LENGTH),
    operation: z.string().max(MAX_DIAGNOSTIC_OPERATION_LENGTH),
    provider: z.string().max(MAX_PROVIDER_ID_LENGTH),
    retryable: z.boolean(),
  })
  .strict() satisfies z.ZodType<CollectionError>;

export const CollectionDiagnosticsSchema = z
  .object({
    errors: z.array(CollectionErrorSchema).max(MAX_COLLECTION_ERRORS),
    evidenceCount: z.number().int().nonnegative().max(MAX_COLLECTION_COUNT),
    failedCount: z.number().int().nonnegative().max(MAX_COLLECTION_COUNT),
    succeededCount: z.number().int().nonnegative().max(MAX_COLLECTION_COUNT),
  })
  .strict() satisfies z.ZodType<CollectionDiagnostics>;

export const CollectionDiagnosticsSummarySchema = CollectionDiagnosticsSchema.omit({
  errors: true,
}).strip() satisfies z.ZodType<CollectionDiagnosticsSummary>;

const displayStringSchema = (maxLength: number) => z.string().trim().min(1).max(maxLength);
const ShortDisplayStringSchema = displayStringSchema(MAX_ANALYSIS_SHORT_TEXT_LENGTH);
const DescriptionStringSchema = displayStringSchema(MAX_ANALYSIS_DESCRIPTION_LENGTH);

export const UnderstandingCompositionItemSchema = z
  .object({
    description: DescriptionStringSchema,
    salience: z.number().int().min(0).max(100),
    title: ShortDisplayStringSchema,
  })
  .strict() satisfies z.ZodType<UnderstandingCompositionItem>;

const compositionVectorSchema = (maxItems: number) =>
  z
    .array(UnderstandingCompositionItemSchema)
    .max(maxItems)
    .transform((items) => items.toSorted((a, b) => b.salience - a.salience));

export const UnderstandingAnalysisSchema = z
  .object({
    composition: z
      .object({
        identities: compositionVectorSchema(6),
        interests: compositionVectorSchema(8),
        lifeStyle: compositionVectorSchema(6),
        social: compositionVectorSchema(6),
        working: compositionVectorSchema(6),
      })
      .strict(),
    personaProposal: z
      .object({
        content: displayStringSchema(MAX_PERSONA_CONTENT_LENGTH),
        reasoning: DescriptionStringSchema,
        tagline: ShortDisplayStringSchema,
      })
      .strict(),
    profile: z
      .object({
        domains: z.array(ShortDisplayStringSchema).max(8),
        description: DescriptionStringSchema,
        name: ShortDisplayStringSchema,
        pronoun: ShortDisplayStringSchema,
        roles: z.array(ShortDisplayStringSchema).max(8),
        summary: DescriptionStringSchema,
        tagline: ShortDisplayStringSchema,
      })
      .strict(),
  })
  .strict() satisfies z.ZodType<StrictOnly<UnderstandingAnalysis>>;

export const OnboardingUnderstandingMessageMetadataSchema = z
  .object({
    analysis: UnderstandingAnalysisSchema,
    diagnostics: CollectionDiagnosticsSchema,
    kind: z.literal('proposal'),
    providers: z.array(z.string().max(MAX_PROVIDER_ID_LENGTH)),
    resultId: z.string(),
    sourceFingerprint: z.string(),
  })
  .strict() satisfies z.ZodType<StrictOnly<OnboardingUnderstandingMessageMetadata>>;

export const UnderstandingProviderStateSchema = z
  .object({
    completedAt: z.string().optional(),
    errors: z.array(CollectionErrorSchema).max(MAX_COLLECTION_ERRORS),
    failedCount: z.number().int().nonnegative().max(MAX_COLLECTION_COUNT),
    revision: z.number().int().nonnegative().max(MAX_COLLECTION_COUNT),
    status: z.enum(['pending', 'running', 'completed', 'failed']),
    succeededCount: z.number().int().nonnegative().max(MAX_COLLECTION_COUNT),
  })
  .strict() satisfies z.ZodType<UnderstandingProviderState>;

const understandingWritingStateBaseShape = {
  sourceFingerprint: z.string(),
  updatedAt: z.string(),
};

export const UnderstandingWritingStateSchema = z.discriminatedUnion('status', [
  z
    .object({
      ...understandingWritingStateBaseShape,
      resultMessageId: z.string().optional(),
      status: z.literal('running'),
    })
    .strict(),
  z
    .object({
      ...understandingWritingStateBaseShape,
      resultMessageId: z.string(),
      status: z.literal('completed'),
    })
    .strict(),
  z
    .object({
      ...understandingWritingStateBaseShape,
      error: CollectionErrorSchema,
      resultMessageId: z.string().optional(),
      status: z.literal('failed'),
    })
    .strict(),
]) satisfies z.ZodType<UnderstandingWritingState>;

export const OnboardingUnderstandingSessionSchema = z
  .object({
    confirmedAt: z.string().optional(),
    id: z.string(),
    sources: z.record(z.string().max(MAX_PROVIDER_ID_LENGTH), UnderstandingProviderStateSchema),
    writing: UnderstandingWritingStateSchema.optional(),
  })
  .strict() satisfies z.ZodType<OnboardingUnderstandingSession>;

export const projectOnboardingUnderstandingSessionStatus = (
  session: OnboardingUnderstandingSession,
): OnboardingUnderstandingSessionStatus => {
  const sources = Object.values(session.sources);

  if (sources.length === 0) return 'pending';
  if (sources.some(({ status }) => status === 'pending' || status === 'running')) {
    return 'processing';
  }
  if (sources.every(({ status }) => status === 'failed')) {
    return session.writing?.resultMessageId ? 'partial' : 'failed';
  }
  if (!session.writing || session.writing.status === 'running') return 'processing';
  if (session.writing.status === 'failed') {
    return session.writing.resultMessageId ? 'partial' : 'failed';
  }

  return sources.some(({ status }) => status === 'failed') ? 'partial' : 'completed';
};

import { z } from 'zod';

export const MAX_COLLECTION_COUNT = 1_000_000;
export const MAX_COLLECTION_ERRORS = 16;
export const MAX_DIAGNOSTIC_CODE_LENGTH = 64;
export const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 160;
export const MAX_DIAGNOSTIC_OPERATION_LENGTH = 64;
export const MAX_PROVIDER_ID_LENGTH = 64;
export const MAX_SOURCE_ACCOUNT_ID_LENGTH = 512;
export const MAX_SOURCE_DISPLAY_NAME_LENGTH = 256;
export const MAX_SOURCE_ID_LENGTH = 512;
export const MAX_ANALYSIS_DESCRIPTION_LENGTH = 2000;
export const MAX_ANALYSIS_SHORT_TEXT_LENGTH = 256;
export const MAX_PERSONA_CONTENT_LENGTH = 4000;

export type UnderstandingRunStatus =
  'pending' | 'resolving' | 'collecting' | 'analyzing' | 'completed' | 'failed' | 'stale';

export type OnboardingUnderstandingSessionStatus =
  'pending' | 'processing' | 'merging' | 'completed' | 'partial' | 'failed';

export interface UnderstandingSourceRef {
  displayName?: string;
  externalAccountId: string;
  id: string;
  provider: string;
}

export interface OnboardingUnderstandingThreadMarker {
  kind: 'merged' | 'source';
}

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

export interface OnboardingUnderstandingConfirmationMetadata {
  composition: UnderstandingComposition;
  diagnostics: CollectionDiagnosticsSummary;
  mergeThreadId: string;
  profile: UnderstandingProfile;
  sessionId: string;
  sources: UnderstandingSourceRef[];
  topicId: string;
}

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

export interface UnderstandingSourceRun {
  assistantMessageId?: string;
  cleanupStatus?: 'completed';
  collectionAttemptId?: string;
  collectionStartedAt?: string;
  completedAt?: string;
  diagnostics?: CollectionDiagnosticsSummary;
  operationId?: string;
  source: UnderstandingSourceRef;
  status: UnderstandingRunStatus;
  threadId: string;
}

export interface UnderstandingMergeRun {
  assistantMessageId?: string;
  cleanupStatus?: 'completed';
  diagnostics?: CollectionDiagnosticsSummary;
  inputThreadIds: string[];
  operationId?: string;
  resultId?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  threadId: string;
}

export interface OnboardingUnderstandingSession {
  id: string;
  initializationStartedAt?: string;
  initializedAt?: string;
  mergeRun?: UnderstandingMergeRun;
  retiredMergeRuns?: UnderstandingMergeRun[];
  retiredRuns?: UnderstandingSourceRun[];
  runs: UnderstandingSourceRun[];
  status: OnboardingUnderstandingSessionStatus;
}

interface OnboardingUnderstandingMessageMetadataBase {
  diagnostics: CollectionDiagnostics;
  resultId: string;
}

export type OnboardingUnderstandingMessageMetadata =
  | (OnboardingUnderstandingMessageMetadataBase & {
      analysis: UnderstandingAnalysis;
      inputThreadIds?: never;
      kind: 'source';
      source: UnderstandingSourceRef;
    })
  | (OnboardingUnderstandingMessageMetadataBase & {
      analysis?: never;
      inputThreadIds?: never;
      kind: 'source_error';
      source: UnderstandingSourceRef;
    })
  | (OnboardingUnderstandingMessageMetadataBase & {
      analysis: UnderstandingAnalysis;
      inputThreadIds: string[];
      kind: 'merged';
      source?: never;
    })
  | (OnboardingUnderstandingMessageMetadataBase & {
      analysis?: never;
      inputThreadIds: string[];
      kind: 'merge_error';
      source?: never;
    });

export type UnderstandingSourceResult = Extract<
  OnboardingUnderstandingMessageMetadata,
  { kind: 'source' | 'source_error' }
>;

export type UnderstandingMergedResult = Extract<
  OnboardingUnderstandingMessageMetadata,
  { kind: 'merge_error' | 'merged' }
>;

export interface UnderstandingSourceRunResult extends UnderstandingSourceRun {
  result?: UnderstandingSourceResult;
}

export interface UnderstandingMergeRunResult extends UnderstandingMergeRun {
  result?: UnderstandingMergedResult;
}

export type UnderstandingDisplayResult =
  | {
      kind: 'provisional';
      result: Extract<UnderstandingSourceResult, { kind: 'source' }>;
    }
  | {
      kind: 'merged';
      result: UnderstandingMergedResult & { analysis: UnderstandingAnalysis };
    };

export interface OnboardingUnderstandingPollingResult {
  displayResult?: UnderstandingDisplayResult;
  errors?: CollectionError[];
  id: string;
  mergeRun?: UnderstandingMergeRunResult;
  runs: UnderstandingSourceRunResult[];
  status: OnboardingUnderstandingSessionStatus;
  warnings?: CollectionError[];
}

export interface OnboardingUnderstandingTopicInput {
  topicId: string;
}

export interface RetryOnboardingUnderstandingSourceInput extends OnboardingUnderstandingTopicInput {
  sessionId: string;
  sourceId: string;
}

export interface ConfirmOnboardingUnderstandingInput extends OnboardingUnderstandingTopicInput {
  resultId: string;
  sessionId: string;
}

export interface ConfirmOnboardingUnderstandingResult {
  confirmed: true;
  resultId: string;
  sessionId: string;
}

export const UnderstandingSourceRefSchema = z
  .object({
    displayName: z.string().max(MAX_SOURCE_DISPLAY_NAME_LENGTH).optional(),
    externalAccountId: z.string().max(MAX_SOURCE_ACCOUNT_ID_LENGTH),
    id: z.string().max(MAX_SOURCE_ID_LENGTH),
    provider: z.string().max(MAX_PROVIDER_ID_LENGTH),
  })
  .strict() satisfies z.ZodType<UnderstandingSourceRef>;

export const CollectionDiagnosticsSchema = z
  .object({
    errors: z
      .array(
        z
          .object({
            code: z.string().max(MAX_DIAGNOSTIC_CODE_LENGTH),
            message: z.string().max(MAX_DIAGNOSTIC_MESSAGE_LENGTH),
            operation: z.string().max(MAX_DIAGNOSTIC_OPERATION_LENGTH),
            provider: z.string().max(MAX_PROVIDER_ID_LENGTH),
            retryable: z.boolean(),
          })
          .strict(),
      )
      .max(MAX_COLLECTION_ERRORS),
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
  .strict() satisfies z.ZodType<UnderstandingAnalysis>;

export const OnboardingUnderstandingMessageMetadataSchema = z.discriminatedUnion('kind', [
  z
    .object({
      analysis: UnderstandingAnalysisSchema,
      diagnostics: CollectionDiagnosticsSchema,
      kind: z.literal('source'),
      resultId: z.string(),
      source: UnderstandingSourceRefSchema,
    })
    .strict(),
  z
    .object({
      diagnostics: CollectionDiagnosticsSchema,
      kind: z.literal('source_error'),
      resultId: z.string(),
      source: UnderstandingSourceRefSchema,
    })
    .strict(),
  z
    .object({
      analysis: UnderstandingAnalysisSchema,
      diagnostics: CollectionDiagnosticsSchema,
      inputThreadIds: z.array(z.string()),
      kind: z.literal('merged'),
      resultId: z.string(),
    })
    .strict(),
  z
    .object({
      diagnostics: CollectionDiagnosticsSchema,
      inputThreadIds: z.array(z.string()),
      kind: z.literal('merge_error'),
      resultId: z.string(),
    })
    .strict(),
]) satisfies z.ZodType<OnboardingUnderstandingMessageMetadata>;

export const UnderstandingSourceRunSchema = z
  .object({
    assistantMessageId: z.string().optional(),
    cleanupStatus: z.literal('completed').optional(),
    collectionAttemptId: z.string().min(1).max(128).optional(),
    collectionStartedAt: z.string().datetime({ offset: true }).optional(),
    completedAt: z.string().datetime({ offset: true }).optional(),
    diagnostics: CollectionDiagnosticsSummarySchema.optional(),
    operationId: z.string().optional(),
    source: UnderstandingSourceRefSchema,
    status: z.enum([
      'pending',
      'resolving',
      'collecting',
      'analyzing',
      'completed',
      'failed',
      'stale',
    ]),
    threadId: z.string(),
  })
  .strict() satisfies z.ZodType<UnderstandingSourceRun>;

export const UnderstandingMergeRunSchema = z
  .object({
    assistantMessageId: z.string().optional(),
    cleanupStatus: z.literal('completed').optional(),
    diagnostics: CollectionDiagnosticsSummarySchema.optional(),
    inputThreadIds: z.array(z.string()),
    operationId: z.string().optional(),
    resultId: z.string().optional(),
    status: z.enum(['pending', 'processing', 'completed', 'failed']),
    threadId: z.string(),
  })
  .strict() satisfies z.ZodType<UnderstandingMergeRun>;

export const OnboardingUnderstandingSessionSchema = z
  .object({
    id: z.string(),
    initializationStartedAt: z.string().datetime({ offset: true }).optional(),
    initializedAt: z.string().datetime({ offset: true }).optional(),
    mergeRun: UnderstandingMergeRunSchema.optional(),
    retiredMergeRuns: z.array(UnderstandingMergeRunSchema).optional(),
    retiredRuns: z.array(UnderstandingSourceRunSchema).optional(),
    runs: z.array(UnderstandingSourceRunSchema),
    status: z.enum(['pending', 'processing', 'merging', 'completed', 'partial', 'failed']),
  })
  .strict()
  .superRefine((session, context) => {
    const allSourceRuns = [...(session.retiredRuns ?? []), ...session.runs];
    const allMergeRuns = [
      ...(session.retiredMergeRuns ?? []),
      ...(session.mergeRun ? [session.mergeRun] : []),
    ];
    const allRuntimeRuns = [...allSourceRuns, ...allMergeRuns];
    const uniqueFields = [
      ['operationId', allRuntimeRuns.flatMap((run) => (run.operationId ? [run.operationId] : []))],
      ['threadId', allRuntimeRuns.map((run) => run.threadId)],
      [
        'assistantMessageId',
        allRuntimeRuns.flatMap((run) => (run.assistantMessageId ? [run.assistantMessageId] : [])),
      ],
      ['source.id', session.runs.map((run) => run.source.id)],
    ] as const;

    for (const [field, values] of uniqueFields) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate Understanding runtime ${field}`,
          path: ['runs'],
        });
      }
    }

    if (!session.mergeRun) return;
    const expectedInputThreadIds = session.runs
      .filter((run) => run.status === 'completed')
      .map((run) => run.threadId);
    if (
      JSON.stringify(session.mergeRun.inputThreadIds) !== JSON.stringify(expectedInputThreadIds)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Understanding merge inputs must match completed source runs in manifest order',
        path: ['mergeRun', 'inputThreadIds'],
      });
    }
  }) satisfies z.ZodType<OnboardingUnderstandingSession>;

const TERMINAL_SOURCE_STATUSES: ReadonlySet<UnderstandingRunStatus> = new Set([
  'completed',
  'failed',
  'stale',
]);

export const projectOnboardingUnderstandingSessionStatus = (
  session: OnboardingUnderstandingSession,
): OnboardingUnderstandingSessionStatus => {
  if (session.mergeRun?.status === 'completed') {
    return session.runs.every((run) => run.status === 'completed') ? 'completed' : 'partial';
  }
  if (session.mergeRun?.status === 'failed') return 'failed';
  if (session.mergeRun) return 'merging';
  if (session.runs.length === 0) return 'failed';
  if (session.runs.every((run) => TERMINAL_SOURCE_STATUSES.has(run.status))) {
    return session.runs.some((run) => run.status === 'completed') ? 'processing' : 'failed';
  }
  return session.runs.every((run) => run.status === 'pending') ? 'pending' : 'processing';
};

import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import { AgentRuntime, GeneralChatAgent } from '@lobechat/agent-runtime';
import { DEFAULT_MINI_SYSTEM_AGENT_ITEM } from '@lobechat/const';
import type { LobeToolManifest } from '@lobechat/context-engine';
import { generateToolsFromManifest, ToolNameResolver } from '@lobechat/context-engine';
import type { ChatStreamPayload, ModelRuntime } from '@lobechat/model-runtime';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';
import type { ChatToolPayload, MessageToolCall, ModelUsage } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { u } from 'unist-builder';
import { toXml } from 'xast-util-to-xml';
import { x } from 'xastscript';

import type { NightlyReviewContext } from './review/collect';
import type { SelfReviewIdea, SelfReviewProposalBaseSnapshot } from './review/proposal';
import type {
  CloseSelfReviewProposalInput,
  CreateSelfReviewProposalInput,
  CreateSkillIfAbsentInput,
  RefreshSelfReviewProposalInput,
  ReplaceSkillContentCASInput,
  SupersedeSelfReviewProposalInput,
  ToolSet,
  ToolWriteInput,
  ToolWriteResult,
  WriteMemoryInput,
} from './tools/shared';
import type {
  ActionTarget,
  EvidenceRef,
  IterationMode,
  IterationWindow,
  Plan,
  RunResult,
  SelfFeedbackIntent,
} from './types';
import { ReviewRunStatus, Risk, Scope } from './types';

/** Built-in tool identifier used for self-iteration AgentRuntime tool calls. */
export const selfIterationToolIdentifier = 'agent-signal-self-iteration';

/** Read-only self-iteration tools exposed to the tool-first runtime. */
export type ReadToolName =
  | 'getEvidenceDigest'
  | 'getManagedSkill'
  | 'listSelfReviewProposals'
  | 'listManagedSkills'
  | 'readSelfReviewProposal';

/** Write self-iteration tools whose terminal outcomes must be retained by the runtime. */
export type WriteToolName =
  | 'closeSelfReviewProposal'
  | 'createSelfReviewProposal'
  | 'createSkillIfAbsent'
  | 'refreshSelfReviewProposal'
  | 'replaceSkillContentCAS'
  | 'supersedeSelfReviewProposal'
  | 'writeMemory';

/** Artifact-only tools that update runtime ideas or intents without direct resource mutation. */
export type ArtifactToolName =
  | 'recordReflectionIdea'
  | 'recordSelfFeedbackIntent'
  | 'recordSelfReviewIdea';

/** Self-iteration tool names exposed to the model. */
export type RuntimeToolName = ReadToolName | WriteToolName | ArtifactToolName;

/**
 * Context accepted by the self-iteration runtime.
 */
export interface ExecuteSelfIterationContext {
  /** Stable agent id being reviewed. */
  agentId: string;
  /** Agent document evidence serialized into the runtime prompt when available. */
  documentActivity?: unknown;
  /** User feedback evidence serialized into the runtime prompt when available. */
  feedbackActivity?: unknown;
  /** Managed skill summaries serialized into the runtime prompt when available. */
  managedSkills?: unknown;
  /** Existing proposal activity serialized into the runtime prompt when available. */
  proposalActivity?: unknown;
  /** Recent receipt evidence serialized into the runtime prompt when available. */
  receiptActivity?: unknown;
  /** Relevant memory evidence serialized into the runtime prompt when available. */
  relevantMemories?: unknown;
  /** Optional review-window end retained for nightly compatibility. */
  reviewWindowEnd?: string;
  /** Optional review-window start retained for nightly compatibility. */
  reviewWindowStart?: string;
  /** Candidate evidence from immediate self-feedback serialized into the runtime prompt when available. */
  selfFeedbackCandidates?: unknown;
  /** Derived self-review signal evidence serialized into the runtime prompt when available. */
  selfReviewSignals?: unknown;
  /** Tool activity evidence serialized into the runtime prompt when available. */
  toolActivity?: unknown;
  /** Topic activity evidence serialized into the runtime prompt when available. */
  topics?: unknown;
  /** Stable user id owning the reviewed agent. */
  userId: string;
}

/**
 * Input passed to the tool-first self-iteration AgentRuntime loop.
 */
export interface ExecuteSelfIterationInput {
  /** Stable agent id being reviewed. */
  agentId: string;
  /** Bounded nightly review context collected before the run. */
  context: ExecuteSelfIterationContext;
  /** Maximum AgentRuntime steps allowed for the LLM/tool loop. */
  maxSteps: number;
  /**
   * Self-iteration mode for prompt and downstream trace separation.
   *
   * @default 'review'
   */
  mode?: IterationMode;
  /** Model name passed to the injected model runtime. */
  model: string;
  /** Minimal model runtime dependency used to stream chat completions. */
  modelRuntime: Pick<ModelRuntime, 'chat'>;
  /** Stable source id used for tracing and fallback idempotency keys. */
  sourceId: string;
  /** Safe read/write self-iteration tools available to this run. */
  tools: ToolSet;
  /** Stable user id owning the reviewed agent. */
  userId: string;
  /** Evidence window exposed to tools and prompts. Defaults to the review context window. */
  window?: IterationWindow;
}

/**
 * Write result captured from one supported write tool call.
 */
export interface RuntimeWriteOutcome {
  /** Tool result returned by the safe write boundary. */
  result: ToolWriteResult;
  /** Supported write tool that produced this outcome. */
  toolName: WriteToolName;
}

/**
 * Result returned after the self-iteration AgentRuntime loop stops.
 */
export interface ExecuteSelfIterationResult {
  /** Normalized action outcomes for downstream sink-specific projection. */
  actions: RuntimeWriteOutcome[];
  /** Concatenated assistant text streamed across LLM calls. */
  content: string;
  /** Non-actionable self-review ideas captured by the runtime. */
  ideas: SelfReviewIdea[];
  /** Immediate self-feedback intents captured by reflection/intent modes. */
  intents: SelfFeedbackIntent[];
  /** Aggregate runtime status before sink-specific projection. */
  status: ReviewRunStatus;
  /** AgentRuntime steps consumed before stopping. */
  stepCount: number;
  /** Model tool calls resolved against the self-iteration manifest. */
  toolCalls: ChatToolPayload[];
  /** Per-call model usage emitted by streaming callbacks. */
  usage: ModelUsage[];
  /** Terminal write outcomes produced by supported write tools. */
  writeOutcomes: RuntimeWriteOutcome[];
}

interface ToolExecutionResult {
  data: unknown;
  idea?: SelfReviewIdea;
  intent?: SelfFeedbackIntent;
  isWrite: boolean;
  success: boolean;
  toolName?: WriteToolName;
}

type LegacyRuntimeToolName =
  | 'closeSelfReviewProposal'
  | 'createSelfReviewProposal'
  | 'listSelfReviewProposals'
  | 'readSelfReviewProposal'
  | 'refreshSelfReviewProposal'
  | 'supersedeSelfReviewProposal';

const createObjectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  additionalProperties: false,
  properties,
  required,
  type: 'object',
});

const stringSchema = { type: 'string' };
const stringArraySchema = { items: stringSchema, type: 'array' };
const freeformArraySchema = { items: {}, type: 'array' };
const freeformObjectSchema = { additionalProperties: true, type: 'object' };
const proposalActionSchema = createObjectSchema(
  {
    actionType: {
      enum: ['create_skill', 'refine_skill', 'consolidate_skill', 'record_idea'],
      type: 'string',
    },
    applyMode: { enum: ['auto_apply', 'review_required', 'skip'], type: 'string' },
    baseSnapshot: freeformObjectSchema,
    confidence: { type: 'number' },
    dedupeKey: stringSchema,
    evidenceRefs: freeformArraySchema,
    idempotencyKey: stringSchema,
    operation: freeformObjectSchema,
    rationale: stringSchema,
    risk: { enum: ['low', 'medium', 'high'], type: 'string' },
    target: freeformObjectSchema,
  },
  ['actionType', 'rationale', 'target'],
);
const proposalActionsSchema = { items: proposalActionSchema, type: 'array' };

const evidenceRefsSchema = freeformArraySchema;
const ideaSchema = createObjectSchema(
  {
    evidenceRefs: evidenceRefsSchema,
    idempotencyKey: stringSchema,
    rationale: stringSchema,
    risk: { enum: ['low', 'medium', 'high'], type: 'string' },
    target: freeformObjectSchema,
    title: stringSchema,
  },
  ['idempotencyKey', 'rationale', 'evidenceRefs'],
);
const intentOperationSchema = freeformObjectSchema;
const intentSchema = createObjectSchema(
  {
    actionType: stringSchema,
    confidence: { type: 'number' },
    downgradeReason: {
      enum: ['approval_required', 'low_confidence', 'unsupported_in_reflection'],
      type: 'string',
    },
    evidenceRefs: evidenceRefsSchema,
    idempotencyKey: stringSchema,
    intentType: { enum: ['memory', 'skill', 'tooling', 'workflow'], type: 'string' },
    operation: intentOperationSchema,
    rationale: stringSchema,
    risk: { enum: ['low', 'medium', 'high'], type: 'string' },
    target: freeformObjectSchema,
    title: stringSchema,
    urgency: { enum: ['immediate', 'soon', 'later'], type: 'string' },
  },
  ['idempotencyKey', 'intentType', 'confidence', 'urgency', 'rationale', 'evidenceRefs'],
);

/**
 * Tool manifest used to expose current safe read/write tools to the model.
 */
const createToolManifest = (mode: IterationMode): LobeToolManifest => {
  const resourceTools = [
    {
      description: 'List managed skills visible in the reviewed agent scope.',
      name: 'listManagedSkills',
      parameters: createObjectSchema({}),
    },
    {
      description: 'Read one managed skill by skill document id in the reviewed agent scope.',
      name: 'getManagedSkill',
      parameters: createObjectSchema({ skillDocumentId: stringSchema }, ['skillDocumentId']),
    },
    {
      description:
        'Read bounded evidence details for cited topic, message, tool_call, or agent_document ids in the nightly review window. Use this for evidenceRefs; do not pass evidence ids to proposal tools.',
      name: 'getEvidenceDigest',
      parameters: createObjectSchema({
        evidenceIds: stringArraySchema,
        reviewWindowEnd: stringSchema,
        reviewWindowStart: stringSchema,
      }),
    },
    {
      description:
        'Write one durable user memory when evidence explicitly states a stable normal-sensitivity user preference. Prefer this over skill tools for summary/style/preferences.',
      name: 'writeMemory',
      parameters: createObjectSchema(
        {
          content: stringSchema,
          evidenceRefs: freeformArraySchema,
          idempotencyKey: stringSchema,
          proposalKey: stringSchema,
          summary: stringSchema,
        },
        ['idempotencyKey', 'content', 'evidenceRefs'],
      ),
    },
    {
      description: 'Create one managed skill when no existing skill is selected.',
      name: 'createSkillIfAbsent',
      parameters: createObjectSchema(
        {
          bodyMarkdown: stringSchema,
          description: stringSchema,
          idempotencyKey: stringSchema,
          name: stringSchema,
          proposalKey: stringSchema,
          summary: stringSchema,
          title: stringSchema,
        },
        ['idempotencyKey', 'name', 'bodyMarkdown'],
      ),
    },
    {
      description:
        'Replace one existing managed skill after compare-and-swap preflight. Provide baseSnapshot when available; the server completes it from skillDocumentId when omitted.',
      name: 'replaceSkillContentCAS',
      parameters: createObjectSchema(
        {
          baseSnapshot: freeformObjectSchema,
          bodyMarkdown: stringSchema,
          description: stringSchema,
          idempotencyKey: stringSchema,
          proposalKey: stringSchema,
          skillDocumentId: stringSchema,
          summary: stringSchema,
        },
        ['idempotencyKey', 'skillDocumentId', 'bodyMarkdown'],
      ),
    },
  ];

  const reviewTools = [
    {
      description: 'List active and historical self-review proposals in the reviewed agent scope.',
      name: 'listSelfReviewProposals',
      parameters: createObjectSchema({}),
    },
    {
      description:
        'Read one self-review proposal by proposal id or proposalKey from proposalActivity.active or listSelfReviewProposals. Never use topic, message, tool_call, or document evidence ids here.',
      name: 'readSelfReviewProposal',
      parameters: createObjectSchema({
        proposalId: stringSchema,
        proposalKey: stringSchema,
      }),
    },
    {
      description: 'Create one user-visible self-review proposal for later approval.',
      name: 'createSelfReviewProposal',
      parameters: createObjectSchema(
        {
          actions: proposalActionsSchema,
          idempotencyKey: stringSchema,
          metadata: freeformObjectSchema,
          proposalKey: stringSchema,
          summary: stringSchema,
        },
        ['idempotencyKey', 'proposalKey', 'summary', 'actions'],
      ),
    },
    {
      description: 'Refresh an existing self-review proposal after rechecking evidence.',
      name: 'refreshSelfReviewProposal',
      parameters: createObjectSchema(
        {
          idempotencyKey: stringSchema,
          proposalId: stringSchema,
          proposalKey: stringSchema,
          summary: stringSchema,
        },
        ['idempotencyKey', 'proposalId'],
      ),
    },
    {
      description: 'Supersede an existing self-review proposal with a replacement proposal key.',
      name: 'supersedeSelfReviewProposal',
      parameters: createObjectSchema(
        {
          idempotencyKey: stringSchema,
          proposalId: stringSchema,
          proposalKey: stringSchema,
          summary: stringSchema,
          supersededBy: stringSchema,
        },
        ['idempotencyKey', 'proposalId', 'supersededBy'],
      ),
    },
    {
      description: 'Close an existing self-review proposal with an optional lifecycle reason.',
      name: 'closeSelfReviewProposal',
      parameters: createObjectSchema(
        {
          idempotencyKey: stringSchema,
          proposalId: stringSchema,
          proposalKey: stringSchema,
          reason: stringSchema,
          summary: stringSchema,
        },
        ['idempotencyKey', 'proposalId'],
      ),
    },
    {
      description:
        'Record one non-actionable self-review idea or question as a Daily Brief artifact without creating an approval proposal.',
      name: 'recordSelfReviewIdea',
      parameters: ideaSchema,
    },
  ];

  const reflectionTools = [
    {
      description:
        'Record one immediate reflection idea into receipt metadata without creating a Daily Brief proposal.',
      name: 'recordReflectionIdea',
      parameters: ideaSchema,
    },
    {
      description:
        'Record one approval-gated, structural, unsupported, or low-confidence self-feedback intent into receipt metadata for later self-review.',
      name: 'recordSelfFeedbackIntent',
      parameters: intentSchema,
    },
  ];

  return {
    api: [...resourceTools, ...(mode === 'review' ? reviewTools : reflectionTools)],
    identifier: selfIterationToolIdentifier,
    meta: {
      description: 'Read evidence and apply safe resource operations.',
      title: 'Agent Signal Self-Iteration',
    },
    systemRole:
      mode === 'review'
        ? 'Use resource read tools before writes when evidence is incomplete. Use getEvidenceDigest for topic/message/tool_call/agent_document evidenceRefs. Use readSelfReviewProposal only with proposal keys from proposalActivity.active or listSelfReviewProposals, never with evidence ids. Treat write tool results as the source of truth.'
        : 'Use resource read tools before writes when evidence is incomplete. Direct-apply only safe memory or bounded skill updates. Record approval-gated or unsupported reflection output with recordSelfFeedbackIntent, and record non-actionable thoughts with recordReflectionIdea.',
    type: 'builtin',
  };
};

export const selfIterationToolManifest = createToolManifest('review');

const SELF_ITERATION_SYSTEM_ROLE = [
  'You are the Agent Signal self-iteration agent.',
  'Inspect the bounded nightly review context and use the provided self-iteration tools to read evidence or apply safe write operations.',
  'Evidence ids and proposal keys are different namespaces: read topic/message/tool_call/agent_document evidence with getEvidenceDigest; read proposals with readSelfReviewProposal only when using proposalActivity.active[].proposalKey or keys returned from listSelfReviewProposals.',
  'Never claim that a write happened unless a write tool result confirms it.',
  'Use writeMemory for explicit durable user preferences such as response style, summary structure, or verification-reporting preferences. Do not turn those preference memories into skills or proposals.',
  'Use createSkillIfAbsent only when evidence describes a reusable workflow and you can provide a non-empty skill name and full bodyMarkdown.',
  'When review evidence supports an approval-gated change, call createSelfReviewProposal in this run; do not offer to draft it later.',
  'For createSelfReviewProposal actions, use actionType exactly create_skill, refine_skill, consolidate_skill, or record_idea. For refine_skill include target.skillDocumentId and operation { domain: "skill", operation: "refine", input: { skillDocumentId, bodyMarkdown } }. For consolidate_skill include operation { domain: "skill", operation: "consolidate", input: { canonicalSkillDocumentId, sourceSkillIds, bodyMarkdown } }. Prefer recordSelfReviewIdea instead of proposal actions when the output is only a thought or question.',
  'Stop after the useful self-iteration work is complete and summarize the confirmed outcome.',
].join('\n');

const TOOL_NAME_SEPARATOR = '____';
const SELF_ITERATION_TOOL_ERROR_MESSAGE = 'Self-iteration tool call failed.';
const FORCE_FINISH_EXTRA_STEPS = 4;

const getIterationMode = (input: ExecuteSelfIterationInput): IterationMode =>
  input.mode ?? 'review';

const getIterationWindow = (input: ExecuteSelfIterationInput): IterationWindow => ({
  end: input.window?.end ?? input.context.reviewWindowEnd ?? new Date(0).toISOString(),
  localDate: input.window?.localDate,
  start: input.window?.start ?? input.context.reviewWindowStart ?? new Date(0).toISOString(),
  timezone: input.window?.timezone,
});

const createNightlyReviewPromptXml = (
  input: ExecuteSelfIterationInput,
  window: IterationWindow,
) => {
  return toXml(
    u('root', [
      x(
        'self_iteration_review',
        {
          agent_id: input.agentId,
          review_window_end: window.end,
          review_window_start: window.start,
          source_id: input.sourceId,
          user_id: input.userId,
        },
        x(
          'review_objective',
          'Inspect this nightly review context and create a self-review proposal when the evidence supports an approval-gated change. Do not finish with only text when a proposal is required.',
        ),
        x(
          'review_policy_markdown',
          // Keep this as a rule table, not a precomputed proposal payload. The model still has
          // to decide and call the write tool, so local E2E proves the self-review path instead
          // of only proving that a hard-coded proposal candidate was copied into the tool call.
          [
            'Use these deterministic self-review signal rules before deciding to finish without tools.',
            '',
            '| Signal kind | Required decision | Tool call | Notes |',
            '| --- | --- | --- | --- |',
            '| `skill_document_with_tool_failure` | Approval-gated skill refinement proposal | `createSelfReviewProposal` with one `refine_skill` action | Use the matching `managedSkills[].documentId` or `documentActivity.skillBucket[].agentDocumentId` as `target.skillDocumentId`; include `operation: { domain: "skill", operation: "refine", input: { skillDocumentId, bodyMarkdown } }`; cite topic/message/agent_document evidence refs. |',
            '| `repeated_tool_failure` involving `replaceSkillContentCAS` | Do not retry the write directly during nightly review | `createSelfReviewProposal` when the failed args contain a corrected skill body or a clear skill target | Prefer the failed tool args as the proposed body; call `getEvidenceDigest` first if the body or target is not visible in context. |',
            '| `skill_documents_maybe_overlap` | Consolidation candidate | `createSelfReviewProposal` with `consolidate_skill` only when there is a canonical skill and explicit source skills | Otherwise record no proposal for this signal alone. |',
            '',
            'If a rule says `createSelfReviewProposal`, do not stop with only explanatory text. If required fields are missing, use read tools once to gather them; only skip when evidence remains insufficient after reading.',
          ].join('\n'),
        ),
        x('review_window', `Review window: ${window.start} to ${window.end}`),
        x('nightly_review_context_json', JSON.stringify(input.context)),
      ),
    ]),
  );
};

const createRuntimePrompt = (input: ExecuteSelfIterationInput) => {
  const window = getIterationWindow(input);
  const mode = getIterationMode(input);

  if (mode === 'review') {
    // TODO:
    // Rework this compatibility branch with the user before committing. The review prompt should
    // eventually share the self-iteration wording, but the current seeded local E2E proved that a
    // naive wording change can drop the Daily Brief proposal path.
    // NOTICE:
    // Keep the original nightly review prompt labels for the review mode.
    // Root cause summary: changing this to the generic self-iteration wording made the local E2E
    // review source complete without producing the expected Daily Brief proposal.
    // Source/context: `devtools/agent-signal/self-iteration-e2e/run-local-e2e.ts` requires one
    // review brief and one approval-gated proposal for the seeded nightly review data.
    // Removal condition: nightly self-review prompt/eval coverage proves the generic prompt still
    // produces equivalent proposal behavior.
    return createNightlyReviewPromptXml(input, window);
  }

  return [
    `Agent id: ${input.agentId}`,
    `User id: ${input.userId}`,
    `Source id: ${input.sourceId}`,
    `Mode: ${mode}`,
    `Evidence window: ${window.start} to ${window.end}`,
    'Self-iteration context JSON:',
    JSON.stringify(input.context),
  ].join('\n');
};

const toNullableString = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

const toBoolean = (value: unknown) => (typeof value === 'boolean' ? value : undefined);

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const toUnknownArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const toStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const toEvidenceRefs = (value: unknown): EvidenceRef[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = toRecord(item);
        const id = toNullableString(record.id);
        const type = toNullableString(record.type);

        if (
          !id ||
          !(
            type === 'topic' ||
            type === 'message' ||
            type === 'operation' ||
            type === 'source' ||
            type === 'receipt' ||
            type === 'tool_call' ||
            type === 'task' ||
            type === 'agent_document' ||
            type === 'memory'
          )
        ) {
          return [];
        }

        return [
          {
            id,
            ...(toNullableString(record.summary)
              ? { summary: toNullableString(record.summary) }
              : {}),
            type,
          },
        ];
      })
    : [];

const toRisk = (value: unknown): Risk => {
  if (value === Risk.High || value === 'high') return Risk.High;
  if (value === Risk.Low || value === 'low') return Risk.Low;

  return Risk.Medium;
};

const toTarget = (value: unknown): ActionTarget | undefined => {
  const record = toRecord(value);
  const target: ActionTarget = {
    memoryId: toNullableString(record.memoryId),
    skillDocumentId: toNullableString(record.skillDocumentId),
    skillName: toNullableString(record.skillName),
    targetReadonly: toBoolean(record.targetReadonly) ?? toBoolean(record.readonly),
    taskIds: toStringArray(record.taskIds),
    topicIds: toStringArray(record.topicIds),
  };

  return Object.values(target).some((item) => (Array.isArray(item) ? item.length > 0 : item))
    ? target
    : undefined;
};

const normalizeProposalActions = (value: unknown) =>
  toUnknownArray(value).map((item) => {
    const record = toRecord(item);

    return {
      ...record,
      actionType: record.actionType === 'record_idea' ? 'proposal_only' : record.actionType,
      applyMode: record.applyMode === 'review_required' ? 'proposal_only' : record.applyMode,
    };
  });

const toReviewIdea = (args: Record<string, unknown>): SelfReviewIdea => ({
  evidenceRefs: toEvidenceRefs(args.evidenceRefs),
  idempotencyKey: toNullableString(args.idempotencyKey) ?? 'shared-idea',
  rationale: toNullableString(args.rationale) ?? toNullableString(args.summary) ?? 'Recorded idea.',
  risk: toRisk(args.risk),
  target: toTarget(args.target),
  title: toNullableString(args.title),
});

const toIntentType = (value: unknown): SelfFeedbackIntent['intentType'] => {
  if (value === 'memory' || value === 'skill' || value === 'tooling' || value === 'workflow') {
    return value;
  }

  return 'workflow';
};

const toUrgency = (value: unknown): SelfFeedbackIntent['urgency'] => {
  if (value === 'immediate' || value === 'soon' || value === 'later') return value;

  return 'later';
};

const toDowngradeReason = (value: unknown): SelfFeedbackIntent['downgradeReason'] => {
  if (
    value === 'approval_required' ||
    value === 'low_confidence' ||
    value === 'unsupported_in_reflection'
  ) {
    return value;
  }
};

const toSelfFeedbackIntent = (args: Record<string, unknown>): SelfFeedbackIntent => ({
  ...toReviewIdea(args),
  actionType: toNullableString(args.actionType),
  confidence: typeof args.confidence === 'number' ? args.confidence : 0.5,
  downgradeReason: toDowngradeReason(args.downgradeReason),
  intentType: toIntentType(args.intentType),
  mode: 'reflection',
  operation: toRecord(args.operation) as SelfFeedbackIntent['operation'],
  urgency: toUrgency(args.urgency),
});

/**
 * Normalizes model-produced tool arguments.
 *
 * Before:
 * - `"{\"name\":\"skill\"}"`
 * - `"not json"`
 *
 * After:
 * - `{ name: "skill" }`
 * - `{}`
 */
const parseToolArguments = (value: string | undefined): Record<string, unknown> => {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;

    return toRecord(parsed);
  } catch {
    return {};
  }
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const getApiNameFromRawToolName = (name: string) => {
  const [identifier, apiName] = name.split(TOOL_NAME_SEPARATOR);

  return identifier === selfIterationToolIdentifier && apiName ? apiName : name;
};

const normalizeToolName = (name: string): RuntimeToolName | LegacyRuntimeToolName | string => {
  if (name === 'listSelfReviewProposals') return 'listSelfReviewProposals';
  if (name === 'readSelfReviewProposal') return 'readSelfReviewProposal';
  if (name === 'createSelfReviewProposal') return 'createSelfReviewProposal';
  if (name === 'refreshSelfReviewProposal') return 'refreshSelfReviewProposal';
  if (name === 'supersedeSelfReviewProposal') return 'supersedeSelfReviewProposal';
  if (name === 'closeSelfReviewProposal') return 'closeSelfReviewProposal';

  return name;
};

const resolveToolCalls = ({
  manifestMap,
  offeredToolNames,
  rawToolCalls,
  toolNameResolver,
}: {
  manifestMap: Record<string, LobeToolManifest>;
  offeredToolNames: string[];
  rawToolCalls: MessageToolCall[];
  toolNameResolver: ToolNameResolver;
}): ChatToolPayload[] => {
  const resolvedToolCalls = toolNameResolver.resolve(rawToolCalls, manifestMap, offeredToolNames);
  const resolvedIds = new Set(resolvedToolCalls.map((toolCall) => toolCall.id));
  const unresolvedToolCalls = rawToolCalls
    .filter((toolCall) => !resolvedIds.has(toolCall.id))
    .map(
      (toolCall): ChatToolPayload => ({
        apiName: getApiNameFromRawToolName(toolCall.function.name),
        arguments: toolCall.function.arguments,
        id: toolCall.id,
        identifier: selfIterationToolIdentifier,
        thoughtSignature: toolCall.thoughtSignature,
        type: 'builtin',
      }),
    );

  return [...resolvedToolCalls, ...unresolvedToolCalls];
};

const createToolError = (message: string): ToolExecutionResult => ({
  data: { error: message },
  isWrite: false,
  success: false,
});

const withUser = <TInput extends ToolWriteInput>(
  toolName: WriteToolName,
  args: Record<string, unknown>,
  input: ExecuteSelfIterationInput,
  toolCallId: string,
  fields: Omit<TInput, keyof ToolWriteInput>,
): TInput =>
  ({
    ...fields,
    idempotencyKey:
      toNullableString(args.idempotencyKey) ?? `${input.sourceId}:${toolName}:${toolCallId}`,
    proposalKey: toNullableString(args.proposalKey),
    summary: toNullableString(args.summary),
    userId: input.userId,
  }) as TInput;

const toBaseSnapshot = (value: unknown): SelfReviewProposalBaseSnapshot => {
  const record = toRecord(value);

  return {
    absent: toBoolean(record.absent),
    agentDocumentId: toNullableString(record.agentDocumentId),
    contentHash: toNullableString(record.contentHash),
    documentId: toNullableString(record.documentId),
    documentUpdatedAt: toNullableString(record.documentUpdatedAt),
    managed: toBoolean(record.managed),
    skillName: toNullableString(record.skillName),
    targetTitle: toNullableString(record.targetTitle),
    targetType: record.targetType === 'skill' ? 'skill' : undefined,
    writable: toBoolean(record.writable),
  };
};

const executeWriteTool = async (
  toolName: WriteToolName,
  operation: () => Promise<ToolWriteResult>,
): Promise<ToolExecutionResult> => ({
  data: await operation(),
  isWrite: true,
  success: true,
  toolName,
});

const executeRuntimeTool = async (
  toolCall: ChatToolPayload,
  input: ExecuteSelfIterationInput,
): Promise<ToolExecutionResult> => {
  const args = parseToolArguments(toolCall.arguments);
  const apiName = normalizeToolName(toolCall.apiName);

  if (apiName === 'listManagedSkills') {
    return {
      data: await input.tools.listManagedSkills({ agentId: input.agentId, userId: input.userId }),
      isWrite: false,
      success: true,
    };
  }

  if (apiName === 'getManagedSkill') {
    const skillDocumentId = toNullableString(args.skillDocumentId);
    if (!skillDocumentId) return createToolError('skillDocumentId is required');

    return {
      data: await input.tools.getManagedSkill({
        agentId: input.agentId,
        skillDocumentId,
        userId: input.userId,
      }),
      isWrite: false,
      success: true,
    };
  }

  if (apiName === 'getEvidenceDigest') {
    const window = getIterationWindow(input);

    return {
      data: await input.tools.getEvidenceDigest({
        agentId: input.agentId,
        evidenceIds: toStringArray(args.evidenceIds),
        reviewWindowEnd: toNullableString(args.reviewWindowEnd) ?? window.end,
        reviewWindowStart: toNullableString(args.reviewWindowStart) ?? window.start,
        userId: input.userId,
      }),
      isWrite: false,
      success: true,
    };
  }

  if (apiName === 'listSelfReviewProposals') {
    return {
      data: await input.tools.listSelfReviewProposals({
        agentId: input.agentId,
        userId: input.userId,
      }),
      isWrite: false,
      success: true,
    };
  }

  if (apiName === 'readSelfReviewProposal') {
    return {
      data: await input.tools.readSelfReviewProposal({
        proposalId: toNullableString(args.proposalId),
        proposalKey: toNullableString(args.proposalKey),
        userId: input.userId,
      }),
      isWrite: false,
      success: true,
    };
  }

  if (apiName === 'recordSelfReviewIdea' || apiName === 'recordReflectionIdea') {
    const idea = toReviewIdea(args);

    return {
      data: {
        idempotencyKey: idea.idempotencyKey,
        status: 'applied',
        summary: idea.title ?? idea.rationale,
      },
      idea,
      isWrite: false,
      success: true,
    };
  }

  if (apiName === 'recordSelfFeedbackIntent') {
    const intent = toSelfFeedbackIntent(args);

    return {
      data: {
        idempotencyKey: intent.idempotencyKey,
        status: 'applied',
        summary: intent.title ?? intent.rationale,
      },
      intent,
      isWrite: false,
      success: true,
    };
  }

  if (apiName === 'createSelfReviewProposal') {
    return executeWriteTool('createSelfReviewProposal', () =>
      input.tools.createSelfReviewProposal(
        withUser<CreateSelfReviewProposalInput>(
          'createSelfReviewProposal',
          args,
          input,
          toolCall.id,
          {
            actions: normalizeProposalActions(args.actions),
            metadata: toRecord(args.metadata),
          },
        ),
      ),
    );
  }

  if (apiName === 'refreshSelfReviewProposal') {
    const proposalId = toNullableString(args.proposalId);
    if (!proposalId) return createToolError('proposalId is required');

    return executeWriteTool('refreshSelfReviewProposal', () =>
      input.tools.refreshSelfReviewProposal(
        withUser<RefreshSelfReviewProposalInput>(
          'refreshSelfReviewProposal',
          args,
          input,
          toolCall.id,
          {
            proposalId,
          },
        ),
      ),
    );
  }

  if (apiName === 'supersedeSelfReviewProposal') {
    const proposalId = toNullableString(args.proposalId);
    const supersededBy = toNullableString(args.supersededBy);
    if (!proposalId) return createToolError('proposalId is required');
    if (!supersededBy) return createToolError('supersededBy is required');

    return executeWriteTool('supersedeSelfReviewProposal', () =>
      input.tools.supersedeSelfReviewProposal(
        withUser<SupersedeSelfReviewProposalInput>(
          'supersedeSelfReviewProposal',
          args,
          input,
          toolCall.id,
          {
            proposalId,
            supersededBy,
          },
        ),
      ),
    );
  }

  if (apiName === 'closeSelfReviewProposal') {
    const proposalId = toNullableString(args.proposalId);
    if (!proposalId) return createToolError('proposalId is required');

    return executeWriteTool('closeSelfReviewProposal', () =>
      input.tools.closeSelfReviewProposal(
        withUser<CloseSelfReviewProposalInput>(
          'closeSelfReviewProposal',
          args,
          input,
          toolCall.id,
          {
            proposalId,
            reason: toNullableString(args.reason),
          },
        ),
      ),
    );
  }

  if (apiName === 'writeMemory') {
    const content = toNullableString(args.content);
    if (!content) return createToolError('content is required');

    const evidenceRefs = toEvidenceRefs(args.evidenceRefs);
    if (evidenceRefs.length === 0) return createToolError('evidenceRefs are required');

    return executeWriteTool('writeMemory', () =>
      input.tools.writeMemory(
        withUser<WriteMemoryInput>('writeMemory', args, input, toolCall.id, {
          content,
          evidenceRefs,
        }),
      ),
    );
  }

  if (apiName === 'createSkillIfAbsent') {
    return executeWriteTool('createSkillIfAbsent', () =>
      input.tools.createSkillIfAbsent(
        withUser<CreateSkillIfAbsentInput>('createSkillIfAbsent', args, input, toolCall.id, {
          bodyMarkdown: toNullableString(args.bodyMarkdown) ?? '',
          description: toNullableString(args.description),
          name: toNullableString(args.name) ?? '',
          title: toNullableString(args.title),
        }),
      ),
    );
  }

  if (apiName === 'replaceSkillContentCAS') {
    const skillDocumentId = toNullableString(args.skillDocumentId);
    if (!skillDocumentId) return createToolError('skillDocumentId is required');

    return executeWriteTool('replaceSkillContentCAS', () =>
      input.tools.replaceSkillContentCAS(
        withUser<ReplaceSkillContentCASInput>('replaceSkillContentCAS', args, input, toolCall.id, {
          baseSnapshot: toBaseSnapshot(args.baseSnapshot),
          bodyMarkdown: toNullableString(args.bodyMarkdown) ?? '',
          description: toNullableString(args.description),
          skillDocumentId,
        }),
      ),
    );
  }

  return createToolError(`Unsupported self-iteration tool: ${apiName}`);
};

const createInitialState = ({
  input,
  manifestMap,
  runtimeTools,
}: {
  input: ExecuteSelfIterationInput;
  manifestMap: Record<string, LobeToolManifest>;
  runtimeTools: ReturnType<typeof generateToolsFromManifest>;
}): AgentState => {
  const createdAt = new Date().toISOString();
  const operationId = `agent-signal-self-iteration:${input.sourceId}`;
  const messages: ChatStreamPayload['messages'] = [
    { content: SELF_ITERATION_SYSTEM_ROLE, role: 'system' },
    { content: createRuntimePrompt(input), role: 'user' },
  ];

  return {
    cost: {
      calculatedAt: createdAt,
      currency: 'USD',
      llm: { byModel: [], currency: 'USD', total: 0 },
      tools: { byTool: [], currency: 'USD', total: 0 },
      total: 0,
    },
    createdAt,
    lastModified: createdAt,
    maxSteps: Math.max(1, input.maxSteps),
    messages,
    metadata: {
      agentId: input.agentId,
      sourceId: input.sourceId,
      trigger: RequestTrigger.AgentSignal,
      userId: input.userId,
    },
    modelRuntimeConfig: {
      model: input.model,
      provider: DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
    },
    operationId,
    operationToolSet: {
      enabledToolIds: [selfIterationToolIdentifier],
      manifestMap,
      sourceMap: { [selfIterationToolIdentifier]: 'builtin' },
      tools: runtimeTools,
    },
    status: 'idle',
    stepCount: 0,
    toolManifestMap: manifestMap,
    toolSourceMap: { [selfIterationToolIdentifier]: 'builtin' },
    tools: runtimeTools,
    usage: {
      humanInteraction: {
        approvalRequests: 0,
        promptRequests: 0,
        selectRequests: 0,
        totalWaitingTimeMs: 0,
      },
      llm: {
        apiCalls: 0,
        processingTimeMs: 0,
        tokens: { input: 0, output: 0, total: 0 },
      },
      tools: {
        byTool: [],
        totalCalls: 0,
        totalTimeMs: 0,
      },
    },
    userInterventionConfig: { approvalMode: 'headless' },
  };
};

/**
 * Runs the tool-first self-iteration agent with a bounded AgentRuntime LLM/tool loop.
 *
 * Triggering workflow:
 *
 * createAgentRunner
 *   -> future server runtime backend
 *     -> `agent_signal.self_iteration_agent.run`
 *       -> {@link executeSelfIteration}
 *
 * Upstream:
 * - {@link createInitialState}
 *
 * Downstream:
 * - {@link executeRuntimeTool}
 *
 * Use when:
 * - Nightly self-review needs real LLM -> tool -> LLM behavior
 * - The caller already has scoped safe self-iteration tools and a model runtime
 *
 * Expects:
 * - Tools enforce their own idempotency, preflight, and receipt contracts
 * - `maxSteps` is a positive finite loop budget
 *
 * Returns:
 * - Final streamed assistant content, step count, model usage, tool calls, and write outcomes
 */
export const executeSelfIteration = async (
  input: ExecuteSelfIterationInput,
): Promise<ExecuteSelfIterationResult> =>
  tracer.startActiveSpan(
    'agent_signal.self_iteration_agent.run',
    {
      attributes: {
        'agent.signal.agent_id': input.agentId,
        'agent.signal.self_iteration.mode': getIterationMode(input),
        'agent.signal.self_iteration_agent.max_steps': input.maxSteps,
        'agent.signal.source_id': input.sourceId,
        'agent.signal.user_id': input.userId,
      },
    },
    async (runSpan) => {
      const maxSteps = Math.max(1, input.maxSteps);
      const toolNameResolver = new ToolNameResolver();
      const manifest = createToolManifest(getIterationMode(input));
      const manifestMap = {
        [selfIterationToolIdentifier]: manifest,
      };
      const runtimeTools = generateToolsFromManifest(manifest);
      const offeredToolNames = runtimeTools.map((tool) => tool.function.name);
      const contentParts: string[] = [];
      const ideas: SelfReviewIdea[] = [];
      const intents: SelfFeedbackIntent[] = [];
      const toolCalls: ChatToolPayload[] = [];
      const usage: ModelUsage[] = [];
      const writeOutcomes: RuntimeWriteOutcome[] = [];
      const runtime = new AgentRuntime(
        new GeneralChatAgent({
          compressionConfig: { enabled: false },
          modelRuntimeConfig: {
            model: input.model,
            provider: DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
          },
          operationId: `agent-signal-self-iteration:${input.sourceId}`,
          userId: input.userId,
        }),
        {
          executors: {
            call_llm: async (instruction, state) => {
              const payload = (
                instruction as { payload: { messages: ChatStreamPayload['messages'] } }
              ).payload;
              let content = '';
              let modelUsage: ModelUsage | undefined;
              let rawToolCalls: MessageToolCall[] = [];

              const response = await input.modelRuntime.chat(
                {
                  messages: payload.messages,
                  model: input.model,
                  stream: true,
                  tools: state.forceFinish ? [] : runtimeTools,
                },
                {
                  callback: {
                    onCompletion: (data) => {
                      modelUsage = data.usage;
                    },
                    onText: (text) => {
                      content += text;
                    },
                    onToolsCalling: ({ toolsCalling }) => {
                      rawToolCalls = toolsCalling;
                    },
                  },
                  metadata: { trigger: RequestTrigger.AgentSignal },
                },
              );
              await consumeStreamUntilDone(response);

              if (content) contentParts.push(content);
              if (modelUsage) usage.push(modelUsage);

              const assistantMessageId = `shared-assistant-${state.stepCount}`;
              const resolvedToolCalls = resolveToolCalls({
                manifestMap,
                offeredToolNames,
                rawToolCalls,
                toolNameResolver,
              });
              toolCalls.push(...resolvedToolCalls);

              const newState = structuredClone(state);
              newState.messages.push({
                content,
                id: assistantMessageId,
                role: 'assistant',
                ...(rawToolCalls.length > 0 ? { tool_calls: rawToolCalls } : {}),
              });

              return {
                events: [
                  {
                    result: { content, tool_calls: rawToolCalls, usage: modelUsage },
                    type: 'llm_result',
                  },
                ],
                newState,
                nextContext: {
                  payload: {
                    hasToolsCalling: resolvedToolCalls.length > 0,
                    parentMessageId: assistantMessageId,
                    result: { content, tool_calls: rawToolCalls },
                    toolsCalling: resolvedToolCalls,
                  },
                  phase: 'llm_result',
                  session: {
                    messageCount: newState.messages.length,
                    sessionId: newState.operationId,
                    status: newState.status,
                    stepCount: newState.stepCount,
                  },
                  stepUsage: modelUsage,
                } satisfies AgentRuntimeContext,
              };
            },
            call_tool: async (instruction, state) => {
              const payload = (
                instruction as {
                  payload: {
                    parentMessageId: string;
                    toolCalling: ChatToolPayload;
                  };
                }
              ).payload;
              const startedAt = Date.now();
              let execution: ToolExecutionResult;

              try {
                execution = await executeRuntimeTool(payload.toolCalling, input);
              } catch {
                execution = {
                  data: { error: SELF_ITERATION_TOOL_ERROR_MESSAGE },
                  isWrite: false,
                  success: false,
                };
              }

              if (execution.isWrite && execution.toolName && execution.success) {
                writeOutcomes.push({
                  result: execution.data as ToolWriteResult,
                  toolName: execution.toolName,
                });
              }
              if (execution.idea && execution.success) ideas.push(execution.idea);
              if (execution.intent && execution.success) intents.push(execution.intent);

              const content = JSON.stringify(execution.data);
              const newState = structuredClone(state);
              newState.messages.push({
                content,
                role: 'tool',
                tool_call_id: payload.toolCalling.id,
              });

              return {
                events: [
                  {
                    id: payload.toolCalling.id,
                    result: { content, success: execution.success },
                    type: 'tool_result',
                  },
                ],
                newState,
                nextContext: {
                  payload: {
                    data: execution.data,
                    executionTime: Date.now() - startedAt,
                    isSuccess: execution.success,
                    parentMessageId: payload.parentMessageId,
                    toolCall: payload.toolCalling,
                    toolCallId: payload.toolCalling.id,
                  },
                  phase: 'tool_result',
                  session: {
                    messageCount: newState.messages.length,
                    sessionId: newState.operationId,
                    status: newState.status,
                    stepCount: newState.stepCount,
                  },
                } satisfies AgentRuntimeContext,
              };
            },
          },
        },
      );
      let state = createInitialState({ input, manifestMap, runtimeTools });
      let context: AgentRuntimeContext = {
        payload: {
          model: input.model,
          provider: DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
          tools: runtimeTools,
        },
        phase: 'user_input',
        session: {
          messageCount: state.messages.length,
          sessionId: state.operationId,
          status: state.status,
          stepCount: state.stepCount,
        },
      };

      try {
        // NOTICE:
        // The public maxSteps policy lives in AgentRuntime via state.maxSteps.
        // The outer loop is only a hard safety cap so force-finish and the final
        // tool-result continuation can run after AgentRuntime crosses maxSteps.
        // Source/context: packages/agent-runtime/src/core/runtime.ts forceFinish handling.
        // Removal condition: AgentRuntime exposes a bounded run-until-done API.
        const hardSafetyStepCap = maxSteps + FORCE_FINISH_EXTRA_STEPS;

        for (let stepIndex = 0; stepIndex < hardSafetyStepCap; stepIndex += 1) {
          if (
            state.status === 'done' ||
            state.status === 'error' ||
            state.status === 'interrupted'
          ) {
            break;
          }

          const result = await tracer.startActiveSpan(
            'agent_signal.self_iteration_agent.step',
            {
              attributes: {
                'agent.signal.agent_id': input.agentId,
                'agent.signal.self_iteration.mode': getIterationMode(input),
                'agent.signal.self_iteration_agent.max_steps': maxSteps,
                'agent.signal.self_iteration_agent.step_count': state.stepCount + 1,
                'agent.signal.source_id': input.sourceId,
                'agent.signal.user_id': input.userId,
              },
            },
            async (stepSpan) => {
              try {
                const stepResult = await runtime.step(state, context);
                stepSpan.setAttribute(
                  'agent.signal.self_iteration_agent.step_count',
                  stepResult.newState.stepCount,
                );

                if (stepResult.newState.status === 'error') {
                  stepSpan.setStatus({ code: SpanStatusCode.ERROR });
                } else {
                  stepSpan.setStatus({ code: SpanStatusCode.OK });
                }

                return stepResult;
              } catch (error) {
                stepSpan.recordException(error as Error);
                stepSpan.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: getErrorMessage(error),
                });

                throw error;
              } finally {
                stepSpan.end();
              }
            },
          );

          state = result.newState;

          if (!result.nextContext) break;
          context = result.nextContext;
        }

        runSpan.setAttribute('agent.signal.self_iteration_agent.step_count', state.stepCount);
        runSpan.setStatus({
          code: state.status === 'error' ? SpanStatusCode.ERROR : SpanStatusCode.OK,
        });

        return {
          actions: writeOutcomes,
          content: contentParts.join(''),
          ideas,
          intents,
          status: state.status === 'error' ? ReviewRunStatus.Failed : ReviewRunStatus.Completed,
          stepCount: state.stepCount,
          toolCalls,
          usage,
          writeOutcomes,
        };
      } catch (error) {
        runSpan.recordException(error as Error);
        runSpan.setStatus({ code: SpanStatusCode.ERROR, message: getErrorMessage(error) });

        throw error;
      } finally {
        runSpan.end();
      }
    },
  );

/** Default step budget for one self-iteration agent run. */
const DEFAULT_MAX_SELF_ITERATION_AGENT_STEPS = 10;

/**
 * Result envelope returned by the bounded self-iteration agent runner.
 */
export interface AgentRunResult {
  /** Executed tool or legacy executor result to persist as receipts. */
  execution: RunResult;
  /** Non-actionable ideas collected during the run. */
  ideas?: SelfReviewIdea[];
  /** Frozen deterministic plan used for Daily Brief proposal projection. */
  projectionPlan: Plan;
  /** Optional number of agent/tool steps consumed by the backend runner. */
  stepCount?: number;
}

/**
 * Input passed to a shared runner backend.
 */
export interface AgentRunnerRunInput {
  /** Bounded digest context collected for one nightly review window. */
  context: NightlyReviewContext;
  /** User-local nightly date used in projected self-iteration plans. */
  localDate?: string;
  /** Maximum backend agent/tool steps allowed for this run. */
  maxSteps: number;
  /** Review scope attached to projected plans and tracing. */
  reviewScope: Scope;
  /** Stable source id used to generate action idempotency keys. */
  sourceId: string;
  /** Safe read/write tools available to the backend runner. */
  tools: ToolSet;
  /** Stable user id owning this run. */
  userId: string;
}

/**
 * Options for creating a bounded self-iteration agent runner.
 */
export interface AgentRunnerOptions {
  /**
   * Maximum backend agent/tool steps.
   *
   * @default 10
   */
  maxSteps?: number;
  /** Backend implementation that may call tools and must return a projected plan. */
  run: (input: AgentRunnerRunInput) => Promise<AgentRunResult>;
  /** Safe tools exposed to the backend implementation. */
  tools: ToolSet;
}

/**
 * Input for one bounded nightly shared run.
 */
export interface AgentRunnerInput {
  /** Bounded digest context collected for one nightly review window. */
  context: NightlyReviewContext;
  /** User-local nightly date used in projected self-iteration plans. */
  localDate?: string;
  /** Stable source id used to generate action idempotency keys. */
  sourceId: string;
  /** Stable user id owning this run. */
  userId: string;
}

const createFailedProjectionPlan = (input: AgentRunnerInput): Plan => ({
  actions: [],
  localDate: input.localDate,
  plannerVersion: 'shared-agent-runner-fallback-v1',
  reviewScope: Scope.Nightly,
  summary: 'Self-iteration review runner failed before producing a valid plan.',
});

/**
 * Creates a bounded runner for nightly self-iteration agent execution.
 *
 * Call stack:
 *
 * createNightlyReviewSourceHandler
 *   -> {@link createAgentRunner}
 *     -> injected `run`
 *       -> safe self-iteration tools
 *
 * Use when:
 * - Nightly self-review should execute through one bounded runner boundary
 * - Tests need to verify fallback and source-id normalization without DB or LLMs
 *
 * Expects:
 * - `sourceId` is stable for idempotency
 * - The backend `run` returns both execution output and the frozen projection plan
 *
 * Returns:
 * - A runner that traces the run, injects tools, enforces the configured step budget, and
 *   returns a conservative failed result if the backend cannot produce a result
 */
export const createAgentRunner = (options: AgentRunnerOptions) => {
  const maxSteps = Math.max(1, options.maxSteps ?? DEFAULT_MAX_SELF_ITERATION_AGENT_STEPS);

  return {
    run: async (input: AgentRunnerInput): Promise<AgentRunResult> =>
      tracer.startActiveSpan(
        'agent_signal.self_iteration_agent.runner.run',
        {
          attributes: {
            'agent.signal.agent_id': input.context.agentId,
            'agent.signal.review_scope': Scope.Nightly,
            'agent.signal.self_iteration_agent.max_steps': maxSteps,
            'agent.signal.source_id': input.sourceId,
            'agent.signal.user_id': input.userId,
          },
        },
        async (span) => {
          try {
            const result = await options.run({
              ...input,
              maxSteps,
              reviewScope: Scope.Nightly,
              tools: options.tools,
            });
            const execution = {
              ...result.execution,
              sourceId: result.execution.sourceId ?? input.sourceId,
            };

            span.setAttribute(
              'agent.signal.self_iteration_agent.plan_action_count',
              result.projectionPlan.actions.length,
            );
            span.setAttribute(
              'agent.signal.self_iteration_agent.execution_action_count',
              execution.actions.length,
            );
            if (typeof result.stepCount === 'number') {
              span.setAttribute('agent.signal.self_iteration_agent.step_count', result.stepCount);
            }
            span.setStatus({ code: SpanStatusCode.OK });

            return {
              ...result,
              execution,
            };
          } catch (error) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message:
                error instanceof Error
                  ? error.message
                  : 'AgentSignal self-iteration agent runner failed',
            });
            span.recordException(error as Error);

            return {
              execution: {
                actions: [],
                sourceId: input.sourceId,
                status: ReviewRunStatus.Failed,
              },
              projectionPlan: createFailedProjectionPlan(input),
              stepCount: maxSteps,
            };
          } finally {
            span.end();
          }
        },
      ),
  };
};

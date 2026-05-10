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

import type { NightlyReviewContext } from './nightlyCollector';
import type { MaintenanceProposalBaseSnapshot } from './proposal';
import type {
  CloseMaintenanceProposalInput,
  CreateMaintenanceProposalInput,
  CreateSkillIfAbsentInput,
  MaintenanceTools,
  MaintenanceToolWriteInput,
  MaintenanceToolWriteResult,
  RefreshMaintenanceProposalInput,
  ReplaceSkillContentCASInput,
  SupersedeMaintenanceProposalInput,
  WriteMemoryInput,
} from './tools';
import type { EvidenceRef } from './types';

/** Built-in tool identifier used for maintenance AgentRuntime tool calls. */
export const maintenanceToolFirstRuntimeToolIdentifier = 'agent-signal-maintenance';

/** Read-only maintenance tools exposed to the tool-first runtime. */
export type MaintenanceReadToolName =
  | 'getEvidenceDigest'
  | 'getManagedSkill'
  | 'listMaintenanceProposals'
  | 'listManagedSkills'
  | 'readMaintenanceProposal';

/** Write maintenance tools whose terminal outcomes must be retained by the runtime. */
export type MaintenanceWriteToolName =
  | 'closeMaintenanceProposal'
  | 'createMaintenanceProposal'
  | 'createSkillIfAbsent'
  | 'refreshMaintenanceProposal'
  | 'replaceSkillContentCAS'
  | 'supersedeMaintenanceProposal'
  | 'writeMemory';

/** Maintenance tool names exposed to the model. */
export type MaintenanceRuntimeToolName = MaintenanceReadToolName | MaintenanceWriteToolName;

/**
 * Input passed to the tool-first maintenance AgentRuntime loop.
 */
export interface MaintenanceToolFirstRuntimeInput {
  /** Stable agent id being reviewed. */
  agentId: string;
  /** Bounded nightly review context collected before the run. */
  context: NightlyReviewContext;
  /** Maximum AgentRuntime steps allowed for the LLM/tool loop. */
  maxSteps: number;
  /** Model name passed to the injected model runtime. */
  model: string;
  /** Minimal model runtime dependency used to stream chat completions. */
  modelRuntime: Pick<ModelRuntime, 'chat'>;
  /** Stable source id used for tracing and fallback idempotency keys. */
  sourceId: string;
  /** Safe read/write maintenance tools available to this run. */
  tools: MaintenanceTools;
  /** Stable user id owning the reviewed agent. */
  userId: string;
}

/**
 * Write result captured from one supported maintenance write tool call.
 */
export interface MaintenanceToolFirstRuntimeWriteOutcome {
  /** Tool result returned by the safe maintenance write boundary. */
  result: MaintenanceToolWriteResult;
  /** Supported write tool that produced this outcome. */
  toolName: MaintenanceWriteToolName;
}

/**
 * Result returned after the maintenance AgentRuntime loop stops.
 */
export interface MaintenanceToolFirstRuntimeResult {
  /** Concatenated assistant text streamed across LLM calls. */
  content: string;
  /** AgentRuntime steps consumed before stopping. */
  stepCount: number;
  /** Model tool calls resolved against the maintenance manifest. */
  toolCalls: ChatToolPayload[];
  /** Per-call model usage emitted by streaming callbacks. */
  usage: ModelUsage[];
  /** Terminal write outcomes produced by supported maintenance write tools. */
  writeOutcomes: MaintenanceToolFirstRuntimeWriteOutcome[];
}

interface MaintenanceToolExecutionResult {
  data: unknown;
  isWrite: boolean;
  success: boolean;
  toolName?: MaintenanceWriteToolName;
}

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
      enum: ['create_skill', 'refine_skill', 'consolidate_skill', 'proposal_only'],
      type: 'string',
    },
    applyMode: { enum: ['auto_apply', 'proposal_only', 'skip'], type: 'string' },
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

/**
 * Tool manifest used to expose current safe maintenance read/write tools to the model.
 */
export const maintenanceToolFirstRuntimeManifest = {
  api: [
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
      description: 'List active and historical maintenance proposals in the reviewed agent scope.',
      name: 'listMaintenanceProposals',
      parameters: createObjectSchema({}),
    },
    {
      description:
        'Read one maintenance proposal by proposal id or proposalKey from proposalActivity.active or listMaintenanceProposals. Never use topic, message, tool_call, or document evidence ids here.',
      name: 'readMaintenanceProposal',
      parameters: createObjectSchema({
        proposalId: stringSchema,
        proposalKey: stringSchema,
      }),
    },
    {
      description: 'Create one user-visible maintenance proposal for later approval.',
      name: 'createMaintenanceProposal',
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
      description: 'Refresh an existing maintenance proposal after rechecking evidence.',
      name: 'refreshMaintenanceProposal',
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
      description: 'Supersede an existing maintenance proposal with a replacement proposal key.',
      name: 'supersedeMaintenanceProposal',
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
      description: 'Close an existing maintenance proposal with an optional lifecycle reason.',
      name: 'closeMaintenanceProposal',
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
  ],
  identifier: maintenanceToolFirstRuntimeToolIdentifier,
  meta: {
    description: 'Read nightly evidence and apply safe maintenance operations.',
    title: 'Agent Signal Maintenance',
  },
  systemRole:
    'Use maintenance read tools before writes when evidence is incomplete. Use getEvidenceDigest for topic/message/tool_call/agent_document evidenceRefs. Use readMaintenanceProposal only with proposal keys from proposalActivity.active or listMaintenanceProposals, never with evidence ids. Treat write tool results as the source of truth.',
  type: 'builtin',
} satisfies LobeToolManifest;

const MAINTENANCE_TOOL_FIRST_SYSTEM_ROLE = [
  'You are the Agent Signal maintenance agent.',
  'Inspect the bounded nightly review context and use the provided maintenance tools to read evidence or apply safe write operations.',
  'Evidence ids and proposal keys are different namespaces: read topic/message/tool_call/agent_document evidence with getEvidenceDigest; read proposals with readMaintenanceProposal only when using proposalActivity.active[].proposalKey or keys returned from listMaintenanceProposals.',
  'Never claim that a write happened unless a write tool result confirms it.',
  'Use writeMemory for explicit durable user preferences such as response style, summary structure, or verification-reporting preferences. Do not turn those preference memories into skills or proposals.',
  'Use createSkillIfAbsent only when evidence describes a reusable workflow and you can provide a non-empty skill name and full bodyMarkdown.',
  'When the evidence supports an approval-gated change, call createMaintenanceProposal in this run; do not offer to draft it later.',
  'For createMaintenanceProposal actions, use actionType exactly create_skill, refine_skill, consolidate_skill, or proposal_only. For refine_skill include target.skillDocumentId and operation { domain: "skill", operation: "refine", input: { skillDocumentId, bodyMarkdown } }.',
  'Stop after the useful maintenance work is complete and summarize the confirmed outcome.',
].join('\n');

const TOOL_NAME_SEPARATOR = '____';
const MAINTENANCE_TOOL_ERROR_MESSAGE = 'Maintenance tool call failed.';
const FORCE_FINISH_EXTRA_STEPS = 4;

const createMaintenanceRuntimePrompt = (input: MaintenanceToolFirstRuntimeInput) =>
  [
    `Agent id: ${input.agentId}`,
    `User id: ${input.userId}`,
    `Source id: ${input.sourceId}`,
    `Review window: ${input.context.reviewWindowStart} to ${input.context.reviewWindowEnd}`,
    'Nightly review context JSON:',
    JSON.stringify(input.context),
  ].join('\n');

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

  return identifier === maintenanceToolFirstRuntimeToolIdentifier && apiName ? apiName : name;
};

const resolveMaintenanceToolCalls = ({
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
        identifier: maintenanceToolFirstRuntimeToolIdentifier,
        thoughtSignature: toolCall.thoughtSignature,
        type: 'builtin',
      }),
    );

  return [...resolvedToolCalls, ...unresolvedToolCalls];
};

const createToolError = (message: string): MaintenanceToolExecutionResult => ({
  data: { error: message },
  isWrite: false,
  success: false,
});

const withUser = <TInput extends MaintenanceToolWriteInput>(
  toolName: MaintenanceWriteToolName,
  args: Record<string, unknown>,
  input: MaintenanceToolFirstRuntimeInput,
  toolCallId: string,
  fields: Omit<TInput, keyof MaintenanceToolWriteInput>,
): TInput =>
  ({
    ...fields,
    idempotencyKey:
      toNullableString(args.idempotencyKey) ?? `${input.sourceId}:${toolName}:${toolCallId}`,
    proposalKey: toNullableString(args.proposalKey),
    summary: toNullableString(args.summary),
    userId: input.userId,
  }) as TInput;

const toBaseSnapshot = (value: unknown): MaintenanceProposalBaseSnapshot => {
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
  toolName: MaintenanceWriteToolName,
  operation: () => Promise<MaintenanceToolWriteResult>,
): Promise<MaintenanceToolExecutionResult> => ({
  data: await operation(),
  isWrite: true,
  success: true,
  toolName,
});

const executeMaintenanceRuntimeTool = async (
  toolCall: ChatToolPayload,
  input: MaintenanceToolFirstRuntimeInput,
): Promise<MaintenanceToolExecutionResult> => {
  const args = parseToolArguments(toolCall.arguments);

  if (toolCall.apiName === 'listManagedSkills') {
    return {
      data: await input.tools.listManagedSkills({ agentId: input.agentId, userId: input.userId }),
      isWrite: false,
      success: true,
    };
  }

  if (toolCall.apiName === 'getManagedSkill') {
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

  if (toolCall.apiName === 'getEvidenceDigest') {
    return {
      data: await input.tools.getEvidenceDigest({
        agentId: input.agentId,
        evidenceIds: toStringArray(args.evidenceIds),
        reviewWindowEnd: toNullableString(args.reviewWindowEnd) ?? input.context.reviewWindowEnd,
        reviewWindowStart:
          toNullableString(args.reviewWindowStart) ?? input.context.reviewWindowStart,
        userId: input.userId,
      }),
      isWrite: false,
      success: true,
    };
  }

  if (toolCall.apiName === 'listMaintenanceProposals') {
    return {
      data: await input.tools.listMaintenanceProposals({
        agentId: input.agentId,
        userId: input.userId,
      }),
      isWrite: false,
      success: true,
    };
  }

  if (toolCall.apiName === 'readMaintenanceProposal') {
    return {
      data: await input.tools.readMaintenanceProposal({
        proposalId: toNullableString(args.proposalId),
        proposalKey: toNullableString(args.proposalKey),
        userId: input.userId,
      }),
      isWrite: false,
      success: true,
    };
  }

  if (toolCall.apiName === 'createMaintenanceProposal') {
    return executeWriteTool('createMaintenanceProposal', () =>
      input.tools.createMaintenanceProposal(
        withUser<CreateMaintenanceProposalInput>(
          'createMaintenanceProposal',
          args,
          input,
          toolCall.id,
          {
            actions: toUnknownArray(args.actions),
            metadata: toRecord(args.metadata),
          },
        ),
      ),
    );
  }

  if (toolCall.apiName === 'refreshMaintenanceProposal') {
    const proposalId = toNullableString(args.proposalId);
    if (!proposalId) return createToolError('proposalId is required');

    return executeWriteTool('refreshMaintenanceProposal', () =>
      input.tools.refreshMaintenanceProposal(
        withUser<RefreshMaintenanceProposalInput>(
          'refreshMaintenanceProposal',
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

  if (toolCall.apiName === 'supersedeMaintenanceProposal') {
    const proposalId = toNullableString(args.proposalId);
    const supersededBy = toNullableString(args.supersededBy);
    if (!proposalId) return createToolError('proposalId is required');
    if (!supersededBy) return createToolError('supersededBy is required');

    return executeWriteTool('supersedeMaintenanceProposal', () =>
      input.tools.supersedeMaintenanceProposal(
        withUser<SupersedeMaintenanceProposalInput>(
          'supersedeMaintenanceProposal',
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

  if (toolCall.apiName === 'closeMaintenanceProposal') {
    const proposalId = toNullableString(args.proposalId);
    if (!proposalId) return createToolError('proposalId is required');

    return executeWriteTool('closeMaintenanceProposal', () =>
      input.tools.closeMaintenanceProposal(
        withUser<CloseMaintenanceProposalInput>(
          'closeMaintenanceProposal',
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

  if (toolCall.apiName === 'writeMemory') {
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

  if (toolCall.apiName === 'createSkillIfAbsent') {
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

  if (toolCall.apiName === 'replaceSkillContentCAS') {
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

  return createToolError(`Unsupported maintenance tool: ${toolCall.apiName}`);
};

const createInitialState = ({
  input,
  manifestMap,
  runtimeTools,
}: {
  input: MaintenanceToolFirstRuntimeInput;
  manifestMap: Record<string, LobeToolManifest>;
  runtimeTools: ReturnType<typeof generateToolsFromManifest>;
}): AgentState => {
  const createdAt = new Date().toISOString();
  const operationId = `agent-signal-maintenance:${input.sourceId}`;
  const messages: ChatStreamPayload['messages'] = [
    { content: MAINTENANCE_TOOL_FIRST_SYSTEM_ROLE, role: 'system' },
    { content: createMaintenanceRuntimePrompt(input), role: 'user' },
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
      enabledToolIds: [maintenanceToolFirstRuntimeToolIdentifier],
      manifestMap,
      sourceMap: { [maintenanceToolFirstRuntimeToolIdentifier]: 'builtin' },
      tools: runtimeTools,
    },
    status: 'idle',
    stepCount: 0,
    toolManifestMap: manifestMap,
    toolSourceMap: { [maintenanceToolFirstRuntimeToolIdentifier]: 'builtin' },
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
 * Runs the tool-first maintenance agent with a bounded AgentRuntime LLM/tool loop.
 *
 * Triggering workflow:
 *
 * createMaintenanceAgentRunner
 *   -> future server runtime backend
 *     -> `agent_signal.maintenance_agent.run`
 *       -> {@link runMaintenanceToolFirstRuntime}
 *
 * Upstream:
 * - {@link createInitialState}
 *
 * Downstream:
 * - {@link executeMaintenanceRuntimeTool}
 *
 * Use when:
 * - Nightly maintenance needs real LLM -> tool -> LLM behavior
 * - The caller already has scoped safe maintenance tools and a model runtime
 *
 * Expects:
 * - Tools enforce their own idempotency, preflight, and receipt contracts
 * - `maxSteps` is a positive finite loop budget
 *
 * Returns:
 * - Final streamed assistant content, step count, model usage, tool calls, and write outcomes
 */
export const runMaintenanceToolFirstRuntime = async (
  input: MaintenanceToolFirstRuntimeInput,
): Promise<MaintenanceToolFirstRuntimeResult> =>
  tracer.startActiveSpan(
    'agent_signal.maintenance_agent.run',
    {
      attributes: {
        'agent.signal.agent_id': input.agentId,
        'agent.signal.maintenance_agent.max_steps': input.maxSteps,
        'agent.signal.source_id': input.sourceId,
        'agent.signal.user_id': input.userId,
      },
    },
    async (runSpan) => {
      const maxSteps = Math.max(1, input.maxSteps);
      const toolNameResolver = new ToolNameResolver();
      const manifestMap = {
        [maintenanceToolFirstRuntimeToolIdentifier]: maintenanceToolFirstRuntimeManifest,
      };
      const runtimeTools = generateToolsFromManifest(maintenanceToolFirstRuntimeManifest);
      const offeredToolNames = runtimeTools.map((tool) => tool.function.name);
      const contentParts: string[] = [];
      const toolCalls: ChatToolPayload[] = [];
      const usage: ModelUsage[] = [];
      const writeOutcomes: MaintenanceToolFirstRuntimeWriteOutcome[] = [];
      const runtime = new AgentRuntime(
        new GeneralChatAgent({
          compressionConfig: { enabled: false },
          modelRuntimeConfig: {
            model: input.model,
            provider: DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
          },
          operationId: `agent-signal-maintenance:${input.sourceId}`,
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

              const assistantMessageId = `maintenance-assistant-${state.stepCount}`;
              const resolvedToolCalls = resolveMaintenanceToolCalls({
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
              let execution: MaintenanceToolExecutionResult;

              try {
                execution = await executeMaintenanceRuntimeTool(payload.toolCalling, input);
              } catch (error) {
                execution = {
                  data: { error: MAINTENANCE_TOOL_ERROR_MESSAGE },
                  isWrite: false,
                  success: false,
                };
              }

              if (execution.isWrite && execution.toolName && execution.success) {
                writeOutcomes.push({
                  result: execution.data as MaintenanceToolWriteResult,
                  toolName: execution.toolName,
                });
              }

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
            'agent_signal.maintenance_agent.step',
            {
              attributes: {
                'agent.signal.agent_id': input.agentId,
                'agent.signal.maintenance_agent.max_steps': maxSteps,
                'agent.signal.maintenance_agent.step_count': state.stepCount + 1,
                'agent.signal.source_id': input.sourceId,
                'agent.signal.user_id': input.userId,
              },
            },
            async (stepSpan) => {
              try {
                const stepResult = await runtime.step(state, context);
                stepSpan.setAttribute(
                  'agent.signal.maintenance_agent.step_count',
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

        runSpan.setAttribute('agent.signal.maintenance_agent.step_count', state.stepCount);
        runSpan.setStatus({
          code: state.status === 'error' ? SpanStatusCode.ERROR : SpanStatusCode.OK,
        });

        return {
          content: contentParts.join(''),
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

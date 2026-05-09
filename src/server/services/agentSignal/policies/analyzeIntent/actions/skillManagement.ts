import {
  AgentRuntime,
  type AgentRuntimeContext,
  type AgentState,
  GeneralChatAgent,
} from '@lobechat/agent-runtime';
import type {
  AgenticAttempt,
  BaseAction,
  ExecutorResult,
  SignalAttempt,
} from '@lobechat/agent-signal';
import { DEFAULT_MINI_SYSTEM_AGENT_ITEM } from '@lobechat/const';
import {
  generateToolsFromManifest,
  type LobeToolManifest,
  ToolNameResolver,
} from '@lobechat/context-engine';
import type {
  ChatStreamPayload,
  GenerateObjectSchema,
  ModelRuntime,
} from '@lobechat/model-runtime';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import {
  AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE,
  AGENT_SKILL_CREATE_SYSTEM_ROLE,
  AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE,
  AGENT_SKILL_REFINE_SYSTEM_ROLE,
  createAgentSkillConsolidatePrompt,
  createAgentSkillCreatePrompt,
  createAgentSkillManagerDecisionPrompt,
  createAgentSkillRefinePrompt,
} from '@lobechat/prompts';
import type { ChatToolPayload, MessageToolCall, ModelUsage } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { z } from 'zod';

import type { AgentDocument } from '@/database/models/agentDocuments';
import { AgentDocumentModel } from '@/database/models/agentDocuments';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { getSkillBundle } from '@/server/services/agentDocumentVfs/mounts/skills/providers/providerSkillsAgentDocumentUtils';
import { AgentSignalProcedureInspector } from '@/server/services/agentSignal/procedure';
import { redisPolicyStateStore } from '@/server/services/agentSignal/store/adapters/redis/policyStateStore';
import { SkillManagementDocumentService } from '@/server/services/skillManagement';
import type {
  CreateSkillInput,
  RenameSkillInput,
  ReplaceSkillIndexInput,
  SkillDetail,
  SkillSummary,
} from '@/server/services/skillManagement/types';

import type { RuntimeProcessorContext } from '../../../runtime/context';
import { defineActionHandler } from '../../../runtime/middleware';
import { createSkillManagementService } from '../../../services/maintenance/skill';
import type { ProcedureStateService } from '../../../services/types';
import { hasAppliedActionIdempotency, markAppliedActionIdempotency } from '../../actionIdempotency';
import type { ActionSkillManagementHandle, AgentSignalFeedbackEvidence } from '../../types';
import { AGENT_SIGNAL_POLICY_ACTION_TYPES } from '../../types';
import { createFeedbackActionPlannerSignalHandler } from '../feedbackAction';
import type { RecordedSkillIntent } from '../skillIntentRecord';

export interface SkillManagementCandidateSkill {
  id: string;
  name: string;
  scope: 'agent' | 'builtin' | 'installed';
}

/**
 * Payload passed from skill-domain feedback routing into skill management.
 */
export interface SkillManagementSignalPayload {
  /** Agent that received the feedback. */
  agentId: string;
  /** Optional candidate skills already identified by routing. */
  candidateSkillRefs?: string[];
  /** Existing skills the decision agent may target by agent document id. */
  candidateSkills?: SkillManagementCandidateSkill[];
  /** Evidence extracted from the feedback message. */
  evidence?: Array<{ cue: string; excerpt: string }>;
  /** Original feedback message that motivated the signal. */
  feedbackMessage: string;
  /** Message that originated this same-turn feedback action. */
  messageId?: string;
  /** Runtime scope used to inspect same-turn procedure state. */
  scopeKey?: string;
  /** Optional topic where the feedback happened. */
  topicId?: string;
  /** Optional relevant turn summary. */
  turnContext?: string;
}

export type SkillManagementDecisionAction = 'consolidate' | 'create' | 'noop' | 'refine' | 'reject';

/**
 * Normalized result returned by the skill-management decision step.
 */
export interface SkillManagementDecision {
  /** The v1.2 skill-management action selected for this feedback. */
  action: SkillManagementDecisionAction;
  /** Optional confidence score from the decision model. */
  confidence?: number;
  /** Optional document ids inspected while deciding. */
  documentRefs?: string[];
  /** Optional short explanation for observability. */
  reason?: string;
  /** Optional read hints that should be inspected before refinement or consolidation. */
  requiredReads?: string[];
  /** Optional target managed skill bundle agent document ids selected by the decision model. */
  targetSkillRefs?: string[];
}

export interface SkillManagementActionResult {
  decision: SkillManagementDecision;
  detail?: string;
  status: 'applied' | 'failed' | 'skipped';
  target?: SkillManagementActionTarget;
}

export interface SkillManagementActionTarget {
  agentDocumentId?: string;
  documentId?: string;
  id: string;
  summary?: string;
  title: string;
  type: 'skill';
}

export interface SkillManagementActionInput {
  agentId?: string;
  candidateSkills?: SkillManagementCandidateSkill[];
  evidence?: AgentSignalFeedbackEvidence[];
  feedbackHint?: 'not_satisfied' | 'satisfied';
  message: string;
  messageId?: string;
  reason?: string;
  serializedContext?: string;
  topicId?: string;
}

export interface SkillManagementActionHandlerOptions {
  db: LobeChatDatabase;
  /** Optional procedure state used to read user-stage skill intent records. */
  procedureState?: Pick<ProcedureStateService, 'skillIntentRecords'>;
  selfIterationEnabled: boolean;
  skillCandidateSkillsFactory?: (input: {
    agentId: string;
  }) => Promise<SkillManagementCandidateSkill[]>;
  skillCreateRunner?: (input: SkillCreateAuthoringInput) => Promise<unknown>;
  skillDecisionModel?: SkillManagementAgentModelConfig;
  skillDecisionRunner?: (input: SkillManagementSignalPayload) => Promise<unknown>;
  /** Optional factory used to inspect same-turn document outcomes before decision. */
  skillDecisionToolsetFactory?: (input: { agentId: string }) => SkillDecisionToolset;
  skillMaintainerRunner?: (input: SkillMaintainerWorkflowInput) => Promise<unknown>;
  skillManagementServiceFactory?: (input: { agentId: string }) => SkillManagementOperationService;
  userId: string;
}

export interface SkillDecisionDocumentOutcome {
  agentDocumentId: string;
  hintIsSkill?: boolean;
  relation?: string;
  summary?: string;
}

export interface SkillDecisionCandidateDocument {
  agentDocumentId: string;
  documentId: string;
  filename?: string;
  title?: string;
}

export interface SkillDecisionDocumentSnapshot {
  agentDocumentId: string;
  content?: string;
  description?: string | null;
  documentId?: string;
  filename?: string;
  metadata?: Record<string, unknown>;
  title?: string;
}

export interface SkillDecisionToolset {
  listCandidateDocuments: (input: {
    agentId: string;
    topicId?: string;
  }) => Promise<SkillDecisionCandidateDocument[]>;
  listSameTurnDocumentOutcomes: (input: {
    agentId: string;
    messageId?: string;
    scopeKey?: string;
    topicId?: string;
  }) => Promise<SkillDecisionDocumentOutcome[]>;
  readDocument: (input: { agentDocumentId: string }) => Promise<SkillDecisionDocumentSnapshot>;
}

/**
 * Checks whether a procedure related object references an agent document binding.
 *
 * Use when:
 * - Agent Signal consumes same-turn document tool receipts.
 * - Producers emit `agent-document` receipts whose ids are stable agent document bindings.
 *
 * Expects:
 * - `agent-document` object ids are `agent_documents.id`.
 *
 * Returns:
 * - Whether the object can be read through the Agent Documents service by id.
 */
export const isAgentDocumentRelatedObject = (object: { objectType: string }) =>
  object.objectType === 'agent-document';

/**
 * Reads the agent-signal skill hint from an agent-document snapshot.
 *
 * Use when:
 * - Same-turn document evidence may include document creation intent.
 * - Decision agents need a high-context hint without treating malformed metadata as evidence.
 *
 * Expects:
 * - Metadata may be absent, malformed, or intentionally set to false.
 *
 * Returns:
 * - `true` or `false` only when the metadata explicitly stores a boolean hint.
 * - `undefined` when the hint is absent or malformed.
 */
export const readAgentSignalHintIsSkill = (metadata: unknown): boolean | undefined => {
  if (!metadata || typeof metadata !== 'object') return undefined;

  const agentSignal = (metadata as Record<string, unknown>).agentSignal;
  if (!agentSignal || typeof agentSignal !== 'object') return undefined;

  const hintIsSkill = (agentSignal as Record<string, unknown>).hintIsSkill;
  return typeof hintIsSkill === 'boolean' ? hintIsSkill : undefined;
};

const createRecordedSkillIntentEvidence = (
  record: RecordedSkillIntent | undefined,
): AgentSignalFeedbackEvidence[] => {
  if (!record) return [];

  return [
    {
      cue: 'recorded_skill_intent',
      excerpt: `${record.explicitness}/${record.route}/${record.actionIntent ?? 'none'}: ${
        record.reason ?? 'recorded skill intent'
      }`,
    },
  ];
};

const readRecordedSkillIntentForExecution = async (
  options: SkillManagementActionHandlerOptions,
  action: ActionSkillManagementHandle,
  context: RuntimeProcessorContext,
) => {
  const reader = options.procedureState?.skillIntentRecords?.read;
  if (!reader) return undefined;

  const messageId = action.payload.messageId;
  if (messageId) {
    const record = await reader({
      scopeKey: context.scopeKey,
      sourceId: messageId,
    });
    if (record) return record;
  }

  const sourceId = action.source?.sourceId;
  if (!sourceId || sourceId === messageId) return undefined;

  return reader({
    scopeKey: context.scopeKey,
    sourceId,
  });
};

export interface SkillManagementAgentModelConfig {
  model: string;
  provider: string;
}

export interface SkillMaintainerWorkflowInput {
  decision: SkillManagementDecision;
  signal: SkillManagementActionInput;
  targetSkills: Array<{
    content: string;
    id: string;
    metadata: Record<string, unknown>;
    name: string;
  }>;
  type: 'consolidate' | 'refine';
}

export interface SkillMaintainerWorkflowResult {
  bodyMarkdown: string;
  confidence?: number;
  description?: string;
  reason?: string;
  rename?: {
    newName?: string;
    newTitle?: string;
  };
}

export interface SkillCreateAuthoringInput {
  candidateSkills?: SkillManagementCandidateSkill[];
  decision: SkillManagementDecision;
  signal: SkillManagementActionInput;
  sourceAgentDocumentId?: string;
  sourceDocumentContent?: string;
}

export interface SkillCreateAuthoringResult {
  bodyMarkdown: string;
  confidence?: number;
  description: string;
  name: string;
  reason?: string;
  title?: string;
}

export interface SkillManagementOperationService {
  createSkill: (input: CreateSkillInput) => Promise<SkillDetail>;
  getSkill: (input: {
    agentDocumentId?: string;
    agentId: string;
    includeContent?: boolean;
    name?: string;
  }) => Promise<SkillDetail | undefined>;
  listSkills: (input: { agentId: string }) => Promise<SkillSummary[]>;
  renameSkill: (input: RenameSkillInput) => Promise<SkillDetail | undefined>;
  replaceSkillIndex: (input: ReplaceSkillIndexInput) => Promise<SkillDetail | undefined>;
}

const SkillManagementDecisionSchema = z.object({
  action: z.enum(['create', 'refine', 'consolidate', 'noop', 'reject']),
  confidence: z.number().min(0).max(1).nullable(),
  documentRefs: z.array(z.string()).default([]),
  reason: z.string().nullable(),
  requiredReads: z.array(z.string()),
  targetSkillRefs: z.array(z.string()),
});

const SkillMaintainerWorkflowResultSchema = z.object({
  bodyMarkdown: z.string(),
  confidence: z.number().min(0).max(1).nullable().default(null),
  description: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
  rename: z
    .object({
      newName: z.string().nullable().default(null),
      newTitle: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
});

const SkillCreateAuthoringResultSchema = z.object({
  bodyMarkdown: z.string(),
  confidence: z.number().min(0).max(1).nullable().default(null),
  description: z.string(),
  name: z.string(),
  reason: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
});

const SkillManagementDecisionGenerateObjectSchema = {
  name: 'agent_signal_skill_management_decision',
  schema: {
    additionalProperties: false,
    properties: {
      action: { enum: ['create', 'refine', 'consolidate', 'noop', 'reject'], type: 'string' },
      confidence: {
        anyOf: [{ maximum: 1, minimum: 0, type: 'number' }, { type: 'null' }],
      },
      documentRefs: { items: { type: 'string' }, type: 'array' },
      reason: { type: ['string', 'null'] },
      requiredReads: { items: { type: 'string' }, type: 'array' },
      targetSkillRefs: { items: { type: 'string' }, type: 'array' },
    },
    required: [
      'action',
      'confidence',
      'documentRefs',
      'reason',
      'requiredReads',
      'targetSkillRefs',
    ],
    type: 'object',
  },
  strict: true,
} satisfies GenerateObjectSchema;

const SkillMaintainerWorkflowResultBaseGenerateObjectSchema = {
  schema: {
    additionalProperties: false,
    properties: {
      bodyMarkdown: { type: 'string' },
      confidence: {
        anyOf: [{ maximum: 1, minimum: 0, type: 'number' }, { type: 'null' }],
      },
      description: { type: ['string', 'null'] },
      reason: { type: ['string', 'null'] },
      rename: {
        anyOf: [
          {
            additionalProperties: false,
            properties: {
              newName: { type: ['string', 'null'] },
              newTitle: { type: ['string', 'null'] },
            },
            required: ['newName', 'newTitle'],
            type: 'object',
          },
          { type: 'null' },
        ],
      },
    },
    required: ['bodyMarkdown', 'confidence', 'description', 'reason', 'rename'],
    type: 'object',
  },
  strict: true,
} satisfies Omit<GenerateObjectSchema, 'name'>;

const SkillCreateAuthoringResultGenerateObjectSchema = {
  name: 'agent_signal_skill_create',
  schema: {
    additionalProperties: false,
    properties: {
      bodyMarkdown: { type: 'string' },
      confidence: {
        anyOf: [{ maximum: 1, minimum: 0, type: 'number' }, { type: 'null' }],
      },
      description: { type: 'string' },
      name: { type: 'string' },
      reason: { type: ['string', 'null'] },
      title: { type: ['string', 'null'] },
    },
    required: ['name', 'title', 'description', 'bodyMarkdown', 'reason', 'confidence'],
    type: 'object',
  },
  strict: true,
} satisfies GenerateObjectSchema;

const isSkillManagementDecisionAction = (value: unknown): value is SkillManagementDecisionAction =>
  value === 'create' ||
  value === 'refine' ||
  value === 'consolidate' ||
  value === 'noop' ||
  value === 'reject';

const getStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return undefined;

  const strings = value.filter((item): item is string => typeof item === 'string');

  return strings.length > 0 ? strings : undefined;
};

const normalizeSkillManagementDecision = (decision: unknown): SkillManagementDecision => {
  if (!decision || typeof decision !== 'object') {
    return { action: 'noop', reason: 'decision output was not an object' };
  }

  const record = decision as Record<string, unknown>;
  const action = isSkillManagementDecisionAction(record.action) ? record.action : 'noop';
  const confidence = typeof record.confidence === 'number' ? record.confidence : undefined;
  const documentRefs = getStringArray(record.documentRefs);
  const reason = typeof record.reason === 'string' ? record.reason : undefined;
  const requiredReads = getStringArray(record.requiredReads);
  const targetSkillRefs = getStringArray(record.targetSkillRefs);

  return {
    action,
    ...(confidence === undefined ? {} : { confidence }),
    ...(documentRefs === undefined ? {} : { documentRefs }),
    ...(reason === undefined ? {} : { reason }),
    ...(requiredReads === undefined ? {} : { requiredReads }),
    ...(targetSkillRefs === undefined ? {} : { targetSkillRefs }),
  };
};

const malformedDecisionOutputReason = 'decision structured output was malformed';

const skillDecisionToolIdentifier = 'agent-signal-skill-decision';

const skillDecisionManifest = {
  api: [
    {
      description: 'List document tool outcomes from the same Agent Signal turn.',
      name: 'listSameTurnDocumentOutcomes',
      parameters: {
        additionalProperties: false,
        properties: {
          messageId: { type: ['string', 'null'] },
          scopeKey: { type: ['string', 'null'] },
        },
        required: ['messageId', 'scopeKey'],
        type: 'object',
      },
    },
    {
      description: 'List candidate agent documents when same-turn outcomes are insufficient.',
      name: 'listCandidateDocuments',
      parameters: {
        additionalProperties: false,
        properties: {
          agentId: { type: 'string' },
          topicId: { type: ['string', 'null'] },
        },
        required: ['agentId', 'topicId'],
        type: 'object',
      },
    },
    {
      description: 'Read one agent document by agent document id for attribution before deciding.',
      name: 'readDocument',
      parameters: {
        additionalProperties: false,
        properties: {
          agentDocumentId: { type: 'string' },
          documentId: { type: 'string' },
        },
        required: ['agentDocumentId'],
        type: 'object',
      },
    },
    {
      description:
        'Submit the final skill-management decision after optional read-only inspection.',
      name: 'submitDecision',
      parameters: SkillManagementDecisionGenerateObjectSchema.schema,
    },
  ],
  identifier: skillDecisionToolIdentifier,
  meta: {
    description: 'Read same-turn evidence and submit one skill-management decision.',
    title: 'Agent Signal Skill Decision',
  },
  systemRole: 'Use read-only evidence tools before submitting a skill-management decision.',
  type: 'builtin',
} satisfies LobeToolManifest;

interface SkillDecisionAgentRuntimeInput {
  model: string;
  modelRuntime: Pick<ModelRuntime, 'chat'>;
  payload: SkillManagementSignalPayload;
  tools: SkillDecisionToolset;
}

const toNullableString = (value: unknown) => (typeof value === 'string' ? value : undefined);

const parseToolArguments = (value: string | undefined): Record<string, unknown> => {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const executeSkillDecisionRuntimeTool = async (
  toolCall: ChatToolPayload,
  input: Pick<SkillDecisionAgentRuntimeInput, 'payload' | 'tools'>,
) => {
  const args = parseToolArguments(toolCall.arguments);

  if (toolCall.apiName === 'listSameTurnDocumentOutcomes') {
    return input.tools.listSameTurnDocumentOutcomes({
      agentId: input.payload.agentId,
      messageId: toNullableString(args.messageId) ?? input.payload.messageId,
      scopeKey: toNullableString(args.scopeKey) ?? input.payload.scopeKey,
      topicId: input.payload.topicId,
    });
  }

  if (toolCall.apiName === 'listCandidateDocuments') {
    return input.tools.listCandidateDocuments({
      agentId: input.payload.agentId,
      topicId: toNullableString(args.topicId) ?? input.payload.topicId,
    });
  }

  if (toolCall.apiName === 'readDocument') {
    const agentDocumentId = toNullableString(args.agentDocumentId);
    if (!agentDocumentId) return { error: 'agentDocumentId is required' };

    return input.tools.readDocument({ agentDocumentId });
  }

  return { error: `Unsupported skill decision tool: ${toolCall.apiName}` };
};

/**
 * Runs the skill-management decision agent with the standard Agent Runtime state machine.
 *
 * Use when:
 * - The decision step must inspect same-turn document outcomes before deciding
 * - Tool use should follow the same LLM -> tool -> LLM control flow as normal agents
 *
 * Expects:
 * - Tool implementations are read-only and scoped by agent/message/scope
 * - `submitDecision` is the only terminal tool
 *
 * Returns:
 * - Final normalized skill-management decision
 *
 * Call stack:
 *
 * createSkillDecisionRunner
 *   -> SkillManagementDecisionAgentService.decide
 *     -> {@link runSkillDecisionAgentRuntime}
 *       -> AgentRuntime.step
 */
export const runSkillDecisionAgentRuntime = async (input: SkillDecisionAgentRuntimeInput) => {
  let submittedDecision: SkillManagementDecision | undefined;
  const toolNameResolver = new ToolNameResolver();
  const manifestMap = { [skillDecisionToolIdentifier]: skillDecisionManifest };
  const tools = generateToolsFromManifest(skillDecisionManifest);
  const messages: Array<{ content: string; role: 'system' | 'user' }> = [
    { content: AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE, role: 'system' },
    {
      content: createAgentSkillManagerDecisionPrompt({
        agentId: input.payload.agentId,
        ...(input.payload.candidateSkills?.length
          ? { candidateSkills: input.payload.candidateSkills }
          : {}),
        evidence: input.payload.evidence ?? [],
        feedbackMessage: input.payload.feedbackMessage,
        messageId: input.payload.messageId,
        scopeKey: input.payload.scopeKey,
        topicId: input.payload.topicId,
        turnContext: input.payload.turnContext,
      }),
      role: 'user',
    },
  ];

  const runtime = new AgentRuntime(
    new GeneralChatAgent({
      compressionConfig: { enabled: false },
      modelRuntimeConfig: {
        model: input.model,
        provider: DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
      },
      operationId: `agent-signal-skill-decision:${input.payload.messageId ?? 'message'}`,
    }),
    {
      executors: {
        call_llm: async (instruction, state) => {
          const payload = (instruction as { payload: { messages: ChatStreamPayload['messages'] } })
            .payload;
          let content = '';
          let modelUsage: ModelUsage | undefined;
          let rawToolCalls: MessageToolCall[] = [];

          const response = await input.modelRuntime.chat(
            {
              messages: payload.messages,
              model: input.model,
              stream: true,
              tools,
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

          const assistantMessageId = `skill-decision-assistant-${state.stepCount}`;
          const resolvedToolCalls = toolNameResolver.resolve(rawToolCalls, manifestMap);
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
          const args = parseToolArguments(payload.toolCalling.arguments);
          const data =
            payload.toolCalling.apiName === 'submitDecision'
              ? normalizeSkillManagementDecision(args)
              : await executeSkillDecisionRuntimeTool(payload.toolCalling, input);

          if (payload.toolCalling.apiName === 'submitDecision') {
            submittedDecision = data as SkillManagementDecision;
          }

          const content = JSON.stringify(data);
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
                result: { content, success: true },
                type: 'tool_result',
              },
            ],
            newState,
            nextContext: {
              payload: {
                data,
                executionTime: Date.now() - startedAt,
                isSuccess: true,
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

  const createdAt = new Date().toISOString();
  let state: AgentState = {
    cost: {
      calculatedAt: createdAt,
      currency: 'USD',
      llm: { byModel: [], currency: 'USD', total: 0 },
      tools: { byTool: [], currency: 'USD', total: 0 },
      total: 0,
    },
    createdAt,
    lastModified: createdAt,
    messages,
    metadata: {
      agentId: input.payload.agentId,
      sourceMessageId: input.payload.messageId,
      topicId: input.payload.topicId,
      trigger: RequestTrigger.AgentSignal,
    },
    modelRuntimeConfig: {
      model: input.model,
      provider: DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
    },
    operationId: `agent-signal-skill-decision:${input.payload.messageId ?? 'message'}`,
    operationToolSet: {
      enabledToolIds: [skillDecisionToolIdentifier],
      manifestMap,
      sourceMap: { [skillDecisionToolIdentifier]: 'builtin' },
      tools,
    },
    status: 'idle',
    stepCount: 0,
    toolManifestMap: manifestMap,
    toolSourceMap: { [skillDecisionToolIdentifier]: 'builtin' },
    tools,
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
  let context: AgentRuntimeContext = {
    payload: {
      model: input.model,
      provider: DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
      tools,
    },
    phase: 'user_input',
    session: {
      messageCount: messages.length,
      sessionId: state.operationId,
      status: state.status,
      stepCount: state.stepCount,
    },
  };

  for (let step = 0; step < 14; step += 1) {
    if (submittedDecision) break;
    if (state.status === 'done' || state.status === 'error' || state.status === 'interrupted') {
      break;
    }

    const result = await runtime.step(state, context);
    state = result.newState;

    if (!result.nextContext) break;
    context = result.nextContext;
  }

  return submittedDecision ?? createNoopDecision('decision agent did not submit a decision');
};

/**
 * Executes the skill-management decision step for one skill-domain action payload.
 *
 * Use when:
 * - Feedback has already been routed into the skill domain
 * - Self-iteration policy decides whether the decision agent may run
 *
 * Expects:
 * - `decide` performs the actual skill-management decision step
 *
 * Returns:
 * - A skipped status when disabled, otherwise the decision result
 */
export const executeSkillManagementDecision = async (input: {
  decide: (payload: SkillManagementSignalPayload) => Promise<unknown>;
  payload: SkillManagementSignalPayload;
  selfIterationEnabled: boolean;
}) => {
  if (!input.selfIterationEnabled) {
    return { reason: 'self iteration is disabled', status: 'skipped' as const };
  }

  let decisionOutput: unknown;

  try {
    decisionOutput = await input.decide(input.payload);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { reason: malformedDecisionOutputReason, status: 'skipped' as const };
    }

    throw error;
  }

  const decision = normalizeSkillManagementDecision(decisionOutput);

  return { decision, status: 'decided' as const };
};

const toSkillManagementDecision = (
  value: z.infer<typeof SkillManagementDecisionSchema>,
): SkillManagementDecision => ({
  action: value.action,
  ...(value.confidence === null ? {} : { confidence: value.confidence }),
  ...(value.documentRefs.length === 0 ? {} : { documentRefs: value.documentRefs }),
  ...(value.reason === null ? {} : { reason: value.reason }),
  ...(value.requiredReads.length === 0 ? {} : { requiredReads: value.requiredReads }),
  ...(value.targetSkillRefs.length === 0 ? {} : { targetSkillRefs: value.targetSkillRefs }),
});

/**
 * Lists managed agent skills that the decision agent may target.
 *
 * Use when:
 * - Skill-domain feedback may refine or consolidate existing agent document skills
 * - The decision prompt needs stable target ids instead of natural-language guesses
 *
 * Expects:
 * - `documents` come from one agent's document bindings
 * - Managed skill folders use their directory filename as the package id
 *
 * Returns:
 * - Agent-scoped candidate ids that are managed skill bundle agent document ids
 */
export const collectAgentSkillDecisionCandidates = (
  documents: AgentDocument[],
): SkillManagementCandidateSkill[] => {
  const candidates: SkillManagementCandidateSkill[] = [];

  for (const document of documents) {
    const folder = getSkillBundle(documents, 'agent', document.filename);

    if (!folder || folder.id !== document.id) {
      continue;
    }

    candidates.push({
      id: document.id,
      name: document.title ?? document.filename,
      scope: 'agent',
    });
  }

  return candidates.sort((left, right) => left.id.localeCompare(right.id));
};

const createDefaultSkillDecisionToolset = (
  db: LobeChatDatabase,
  userId: string,
): SkillDecisionToolset => {
  const agentDocumentModel = new AgentDocumentModel(db, userId);
  const agentDocumentsService = new AgentDocumentsService(db, userId);
  const inspector = new AgentSignalProcedureInspector(redisPolicyStateStore);

  return {
    listCandidateDocuments: async ({ agentId, topicId }) => {
      const documents = topicId
        ? await agentDocumentsService.listDocumentsForTopic(agentId, topicId)
        : await agentDocumentModel.findByAgent(agentId);

      return documents.map((document) => ({
        agentDocumentId: document.id,
        documentId: document.documentId,
        filename: document.filename,
        title: document.title,
      }));
    },
    listSameTurnDocumentOutcomes: async ({ messageId, scopeKey }) => {
      if (!scopeKey) return [];

      const snapshot = await inspector.inspectScope(scopeKey);
      const outcomes = snapshot.receipts
        .filter((receipt) => receipt.domainKey.startsWith('document:'))
        .filter((receipt) => !messageId || receipt.messageId === messageId)
        .flatMap((receipt) =>
          (receipt.relatedObjects ?? []).filter(isAgentDocumentRelatedObject).map((object) => ({
            agentDocumentId: object.objectId,
            relation: object.relation,
            summary: receipt.summary,
          })),
        );

      return Promise.all(
        outcomes.map(async (outcome) => {
          const document = await agentDocumentsService.getDocumentSnapshotById(
            outcome.agentDocumentId,
          );
          const hintIsSkill = readAgentSignalHintIsSkill(document?.metadata);

          return {
            ...outcome,
            ...(hintIsSkill === undefined ? {} : { hintIsSkill }),
          };
        }),
      );
    },
    readDocument: async ({ agentDocumentId }) => {
      // NOTICE:
      // This is the Agent Signal decision-only inspection tool, not the chat-visible
      // lobe-agent-documents.readDocument tool and not a skill runtime document tool.
      // The decision agent needs a read-only snapshot to evaluate hinted same-turn documents
      // without invoking user-facing tool permissions or mutating agent document state.
      // Keep this boundary until Agent Signal decision tools are unified with a scoped
      // read-only tool registry.
      const snapshot = await agentDocumentsService.getDocumentSnapshotById(agentDocumentId);
      if (!snapshot) return { agentDocumentId };

      return {
        agentDocumentId,
        content: snapshot.content,
        documentId: snapshot.documentId,
        filename: snapshot.filename,
        metadata: snapshot.metadata ?? undefined,
        title: snapshot.title,
      };
    },
  };
};

const hintedDocumentEvidenceContentLength = 200;

/**
 * Normalizes document evidence for compact decision prompts.
 *
 * Before:
 * - "# Title\n\nLong body..."
 *
 * After:
 * - "# Title Long body..."
 */
const toCompactDocumentEvidenceExcerpt = (content: string) => {
  const normalized = content.replaceAll(/\s+/g, ' ').trim();

  if (normalized.length <= hintedDocumentEvidenceContentLength) return normalized;

  return `${normalized.slice(0, hintedDocumentEvidenceContentLength)}...`;
};

const getDocumentDescription = (document: SkillDecisionDocumentSnapshot) => {
  const description = document.description?.trim();

  if (description) return description;

  const metadataDescription = document.metadata?.description;
  return typeof metadataDescription === 'string' && metadataDescription.trim()
    ? metadataDescription.trim()
    : undefined;
};

const getSkillDecisionToolset = (options: SkillManagementActionHandlerOptions, agentId: string) =>
  options.skillDecisionToolsetFactory?.({ agentId }) ??
  createDefaultSkillDecisionToolset(options.db, options.userId);

const collectHintedSameTurnDocumentEvidence = async (
  input: {
    agentId: string;
    messageId?: string;
    scopeKey: string;
    topicId?: string;
  },
  options: SkillManagementActionHandlerOptions,
): Promise<AgentSignalFeedbackEvidence[]> => {
  if (!input.messageId) return [];

  const tools = getSkillDecisionToolset(options, input.agentId);
  const outcomes = await tools.listSameTurnDocumentOutcomes({
    agentId: input.agentId,
    messageId: input.messageId,
    scopeKey: input.scopeKey,
    topicId: input.topicId,
  });
  const hintedOutcomes = outcomes.filter((outcome) => outcome.hintIsSkill === true);

  if (hintedOutcomes.length === 0) return [];

  const evidence: AgentSignalFeedbackEvidence[] = [];

  for (const outcome of hintedOutcomes) {
    evidence.push({
      cue: 'same_turn_hinted_document',
      excerpt: [
        `agentDocumentId=${outcome.agentDocumentId}`,
        `hintIsSkill=true`,
        outcome.relation ? `relation=${outcome.relation}` : undefined,
        outcome.summary ? `summary=${outcome.summary}` : undefined,
      ]
        .filter(Boolean)
        .join('; '),
    });

    const document = await tools.readDocument({ agentDocumentId: outcome.agentDocumentId });
    const description = getDocumentDescription(document);

    evidence.push({
      cue: description
        ? 'same_turn_hinted_document_description'
        : 'same_turn_hinted_document_content',
      excerpt: [
        `agentDocumentId=${outcome.agentDocumentId}`,
        document.title ? `title=${document.title}` : undefined,
        description
          ? `description=${description}`
          : document.content
            ? `content=${toCompactDocumentEvidenceExcerpt(document.content)}`
            : undefined,
      ]
        .filter(Boolean)
        .join('; '),
    });
  }

  return evidence;
};

const toSkillMaintainerWorkflowResult = (
  value: z.infer<typeof SkillMaintainerWorkflowResultSchema>,
): SkillMaintainerWorkflowResult => ({
  bodyMarkdown: value.bodyMarkdown,
  ...(value.confidence === null ? {} : { confidence: value.confidence }),
  ...(value.description === null ? {} : { description: value.description }),
  ...(value.reason === null ? {} : { reason: value.reason }),
  ...(value.rename === null
    ? {}
    : {
        rename: {
          ...(value.rename.newName === null ? {} : { newName: value.rename.newName }),
          ...(value.rename.newTitle === null ? {} : { newTitle: value.rename.newTitle }),
        },
      }),
});

const toSkillCreateAuthoringResult = (
  value: z.infer<typeof SkillCreateAuthoringResultSchema>,
): SkillCreateAuthoringResult => ({
  bodyMarkdown: value.bodyMarkdown,
  description: value.description,
  name: value.name,
  ...(value.confidence === null ? {} : { confidence: value.confidence }),
  ...(value.reason === null ? {} : { reason: value.reason }),
  ...(value.title === null ? {} : { title: value.title }),
});

class SkillManagementDecisionAgentService {
  private readonly modelConfig: SkillManagementAgentModelConfig;

  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    modelConfig: Partial<SkillManagementAgentModelConfig> = {},
    private toolsetFactory?: SkillManagementActionHandlerOptions['skillDecisionToolsetFactory'],
  ) {
    this.modelConfig = {
      model: modelConfig.model ?? DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
      provider: modelConfig.provider ?? DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
    };
  }

  async decide(input: SkillManagementSignalPayload): Promise<SkillManagementDecision> {
    const modelRuntime = await initModelRuntimeFromDB(
      this.db,
      this.userId,
      this.modelConfig.provider,
    );
    const candidateSkills =
      input.candidateSkills ??
      collectAgentSkillDecisionCandidates(
        await new AgentDocumentModel(this.db, this.userId).findByAgent(input.agentId),
      );

    const result = await runSkillDecisionAgentRuntime({
      model: this.modelConfig.model,
      modelRuntime,
      payload: {
        ...input,
        ...(candidateSkills.length > 0 ? { candidateSkills } : {}),
      },
      tools:
        this.toolsetFactory?.({ agentId: input.agentId }) ??
        createDefaultSkillDecisionToolset(this.db, this.userId),
    });

    return toSkillManagementDecision(
      SkillManagementDecisionSchema.parse({
        confidence: result.confidence ?? null,
        documentRefs: result.documentRefs ?? [],
        reason: result.reason ?? null,
        requiredReads: result.requiredReads ?? [],
        targetSkillRefs: result.targetSkillRefs ?? [],
        action: result.action,
      }),
    );
  }
}

class SkillMaintainerWorkflowAgentService {
  private readonly modelConfig: SkillManagementAgentModelConfig;

  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    modelConfig: Partial<SkillManagementAgentModelConfig> = {},
  ) {
    this.modelConfig = {
      model: modelConfig.model ?? DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
      provider: modelConfig.provider ?? DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
    };
  }

  async run(input: SkillMaintainerWorkflowInput): Promise<SkillMaintainerWorkflowResult> {
    const modelRuntime = await initModelRuntimeFromDB(
      this.db,
      this.userId,
      this.modelConfig.provider,
    );
    const isRefine = input.type === 'refine';
    const content = isRefine
      ? createAgentSkillRefinePrompt({
          reason: input.decision.reason ?? input.signal.reason ?? 'Refine selected skill.',
          signalContext: {
            evidence: input.signal.evidence,
            feedbackHint: input.signal.feedbackHint,
            message: input.signal.message,
            topicId: input.signal.topicId,
          },
          skillContent: input.targetSkills[0]?.content ?? '',
          skillMetadata: input.targetSkills[0]?.metadata ?? {},
        })
      : createAgentSkillConsolidatePrompt({
          reason: input.decision.reason ?? input.signal.reason ?? 'Consolidate selected skills.',
          sourceSkills: input.targetSkills,
        });

    const result = await modelRuntime.generateObject(
      {
        messages: [
          {
            content: isRefine
              ? AGENT_SKILL_REFINE_SYSTEM_ROLE
              : AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE,
            role: 'system',
          },
          { content, role: 'user' },
        ] as never[],
        model: this.modelConfig.model,
        schema: {
          ...SkillMaintainerWorkflowResultBaseGenerateObjectSchema,
          name: `agent_signal_skill_${input.type}`,
        },
      },
      { metadata: { trigger: RequestTrigger.AgentSignal } },
    );

    return toSkillMaintainerWorkflowResult(SkillMaintainerWorkflowResultSchema.parse(result));
  }
}

class SkillCreateAuthoringAgentService {
  private readonly modelConfig: SkillManagementAgentModelConfig;

  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    modelConfig: Partial<SkillManagementAgentModelConfig> = {},
  ) {
    this.modelConfig = {
      model: modelConfig.model ?? DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
      provider: modelConfig.provider ?? DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
    };
  }

  async run(input: SkillCreateAuthoringInput): Promise<SkillCreateAuthoringResult> {
    const modelRuntime = await initModelRuntimeFromDB(
      this.db,
      this.userId,
      this.modelConfig.provider,
    );

    const result = await modelRuntime.generateObject(
      {
        messages: [
          {
            content: AGENT_SKILL_CREATE_SYSTEM_ROLE,
            role: 'system',
          },
          {
            content: createAgentSkillCreatePrompt({
              agentId: input.signal.agentId ?? '',
              ...(input.candidateSkills?.length ? { candidateSkills: input.candidateSkills } : {}),
              evidence: input.signal.evidence ?? [],
              feedbackMessage: input.signal.message,
              sourceAgentDocumentId: input.sourceAgentDocumentId,
              sourceDocumentContent: input.sourceDocumentContent,
              turnContext: input.signal.serializedContext,
            }),
            role: 'user',
          },
        ] as never[],
        model: this.modelConfig.model,
        schema: SkillCreateAuthoringResultGenerateObjectSchema,
      },
      { metadata: { trigger: RequestTrigger.AgentSignal } },
    );

    return toSkillCreateAuthoringResult(SkillCreateAuthoringResultSchema.parse(result));
  }
}

const finalizeAttempt = (
  startedAt: number,
  status: SignalAttempt['status'],
): SignalAttempt | AgenticAttempt => ({
  completedAt: Date.now(),
  current: 1,
  startedAt,
  status,
});

const toExecutorError = (actionId: string, error: unknown, startedAt: number): ExecutorResult => {
  return {
    actionId,
    attempt: finalizeAttempt(startedAt, 'failed'),
    error: {
      cause: error,
      code: 'SKILL_MANAGEMENT_EXECUTION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    },
    status: 'failed',
  };
};

const createNoopDecision = (reason: string): SkillManagementDecision => ({
  action: 'noop',
  reason,
});

const toSkippedExecutorResult = ({
  actionId,
  decision,
  detail,
  startedAt,
}: {
  actionId: string;
  decision: SkillManagementDecision;
  detail?: string;
  startedAt: number;
}): ExecutorResult => ({
  actionId,
  attempt: finalizeAttempt(startedAt, 'skipped'),
  detail,
  output: { decision },
  status: 'skipped',
});

const isSkillManagementAction = (action: BaseAction): action is ActionSkillManagementHandle => {
  return action.actionType === AGENT_SIGNAL_POLICY_ACTION_TYPES.skillManagementHandle;
};

export const createSkillDecisionRunner = (options: SkillManagementActionHandlerOptions) => {
  const agent = new SkillManagementDecisionAgentService(
    options.db,
    options.userId,
    options.skillDecisionModel,
    options.skillDecisionToolsetFactory,
  );

  return (input: SkillManagementSignalPayload) => agent.decide(input);
};

const resolveSkillDecisionCandidates = async (
  options: SkillManagementActionHandlerOptions,
  agentId: string,
) => {
  if (options.skillCandidateSkillsFactory) {
    return options.skillCandidateSkillsFactory({ agentId });
  }

  if (options.skillDecisionRunner) {
    return [];
  }

  return collectAgentSkillDecisionCandidates(
    await new AgentDocumentModel(options.db, options.userId).findByAgent(agentId),
  );
};

const createDefaultSkillManagementService = (
  options: SkillManagementActionHandlerOptions,
): SkillManagementOperationService =>
  new SkillManagementDocumentService(options.db, options.userId);

const getSkillTargets = (decision: SkillManagementDecision) => decision.targetSkillRefs ?? [];

const isMaintainerDecision = (
  decision: SkillManagementDecision,
): decision is SkillManagementDecision & { action: 'consolidate' | 'refine' } =>
  decision.action === 'refine' || decision.action === 'consolidate';

const toSkillActionTarget = (
  skill: Pick<SkillSummary, 'bundle' | 'description' | 'index' | 'title'>,
): SkillManagementActionTarget => ({
  agentDocumentId: skill.index.agentDocumentId,
  documentId: skill.index.documentId,
  id: skill.bundle.documentId,
  summary: skill.description,
  title: skill.title,
  type: 'skill',
});

const readTargetSkills = async (
  service: SkillManagementOperationService,
  agentId: string,
  skillRefs: string[],
) => {
  const results = await Promise.all(
    skillRefs.map((agentDocumentId) =>
      service.getSkill({ agentDocumentId, agentId, includeContent: true }),
    ),
  );

  return results.filter((skill): skill is SkillDetail => Boolean(skill));
};

const runMaintainerWorkflow = async (
  input: SkillManagementActionInput,
  options: SkillManagementActionHandlerOptions,
  decision: SkillManagementDecision & { action: 'consolidate' | 'refine' },
): Promise<SkillManagementActionResult> => {
  if (!input.agentId) {
    return {
      decision,
      detail: 'Missing agentId for skill-maintainer workflow.',
      status: 'skipped',
    };
  }

  const agentId = input.agentId;
  const targetSkillRefs = getSkillTargets(decision);
  const minimumTargets = decision.action === 'consolidate' ? 2 : 1;

  if (targetSkillRefs.length < minimumTargets) {
    return {
      decision,
      detail: `Skill-management ${decision.action} requires targetSkillRefs from the decision agent.`,
      status: 'skipped',
    };
  }

  const service =
    options.skillManagementServiceFactory?.({ agentId }) ??
    createDefaultSkillManagementService(options);
  const workflowRunner =
    options.skillMaintainerRunner ??
    ((workflowInput: SkillMaintainerWorkflowInput) =>
      new SkillMaintainerWorkflowAgentService(
        options.db,
        options.userId,
        options.skillDecisionModel,
      ).run(workflowInput));
  const targetSkills = await readTargetSkills(service, agentId, targetSkillRefs);

  if (targetSkills.length < minimumTargets) {
    return {
      decision,
      detail: `Skill-management ${decision.action} could not resolve targetSkillRefs.`,
      status: 'skipped',
    };
  }

  const workflowResult = toSkillMaintainerWorkflowResult(
    SkillMaintainerWorkflowResultSchema.parse(
      await workflowRunner({
        decision,
        signal: input,
        targetSkills: targetSkills.map((skill) => ({
          content: skill.content ?? '',
          id: skill.bundle.agentDocumentId,
          metadata: { frontmatter: skill.frontmatter },
          name: skill.name,
        })),
        type: decision.action,
      }),
    ),
  );
  const canonical = targetSkills[0];

  if (!canonical) {
    return {
      decision,
      detail: `Skill-management ${decision.action} could not resolve targetSkillRefs.`,
      status: 'skipped',
    };
  }

  let updatedSkill: SkillDetail | SkillSummary = canonical;

  try {
    const skillMaintenanceService = createSkillManagementService({
      consolidateSkill: async () => {
        if (workflowResult.rename?.newName || workflowResult.rename?.newTitle) {
          updatedSkill =
            (await service.renameSkill({
              agentDocumentId: canonical.bundle.agentDocumentId,
              agentId,
              newName: workflowResult.rename.newName,
              newTitle: workflowResult.rename.newTitle,
              updateReason: workflowResult.reason,
            })) ?? updatedSkill;
        }

        updatedSkill =
          (await service.replaceSkillIndex({
            agentDocumentId: canonical.bundle.agentDocumentId,
            agentId,
            bodyMarkdown: workflowResult.bodyMarkdown,
            description: workflowResult.description,
            updateReason: workflowResult.reason,
          })) ?? updatedSkill;

        return {
          skillDocumentId: canonical.bundle.agentDocumentId,
          summary: workflowResult.reason,
        };
      },
      refineSkill: async () => {
        if (workflowResult.rename?.newName || workflowResult.rename?.newTitle) {
          updatedSkill =
            (await service.renameSkill({
              agentDocumentId: canonical.bundle.agentDocumentId,
              agentId,
              newName: workflowResult.rename.newName,
              newTitle: workflowResult.rename.newTitle,
              updateReason: workflowResult.reason,
            })) ?? updatedSkill;
        }

        updatedSkill =
          (await service.replaceSkillIndex({
            agentDocumentId: canonical.bundle.agentDocumentId,
            agentId,
            bodyMarkdown: workflowResult.bodyMarkdown,
            description: workflowResult.description,
            updateReason: workflowResult.reason,
          })) ?? updatedSkill;

        return {
          skillDocumentId: canonical.bundle.agentDocumentId,
          summary: workflowResult.reason,
        };
      },
    });

    if (decision.action === 'consolidate') {
      await skillMaintenanceService.consolidateSkill({
        evidenceRefs: [],
        idempotencyKey: `same-turn-skill:${canonical.bundle.agentDocumentId}`,
        input: {
          approval: { source: 'same_turn_feedback' },
          canonicalSkillDocumentId: canonical.bundle.agentDocumentId,
          sourceSkillIds: targetSkillRefs,
          userId: options.userId,
        },
      });
    } else {
      await skillMaintenanceService.refineSkill({
        evidenceRefs: [],
        idempotencyKey: `same-turn-skill:${canonical.bundle.agentDocumentId}`,
        input: {
          patch: workflowResult.bodyMarkdown,
          skillDocumentId: canonical.bundle.agentDocumentId,
          userId: options.userId,
        },
      });
    }
  } catch (error) {
    return {
      decision,
      detail: error instanceof Error ? error.message : String(error),
      status: 'skipped',
    };
  }

  return {
    decision,
    detail: workflowResult.reason ?? `Applied ${decision.action} maintainer workflow.`,
    status: 'applied',
    target: toSkillActionTarget(updatedSkill),
  };
};

const readCreateSourceDocument = async (
  input: SkillManagementActionInput,
  options: SkillManagementActionHandlerOptions,
  decision: SkillManagementDecision,
) => {
  const sourceAgentDocumentId = decision.documentRefs?.[0];

  if (!input.agentId || !sourceAgentDocumentId) {
    return {};
  }

  const snapshot = await new AgentDocumentsService(
    options.db,
    options.userId,
  ).getDocumentSnapshotById(sourceAgentDocumentId);

  return {
    sourceAgentDocumentId,
    sourceDocumentContent: snapshot?.content,
  };
};

const runCreateWorkflow = async (
  input: SkillManagementActionInput,
  options: SkillManagementActionHandlerOptions,
  decision: SkillManagementDecision,
): Promise<SkillManagementActionResult> => {
  if (!input.agentId) {
    return {
      decision,
      detail: 'Missing agentId for skill-management create workflow.',
      status: 'skipped',
    };
  }

  const agentId = input.agentId;
  const source = await readCreateSourceDocument(input, options, decision);
  const createRunner =
    options.skillCreateRunner ??
    ((authoringInput: SkillCreateAuthoringInput) =>
      new SkillCreateAuthoringAgentService(
        options.db,
        options.userId,
        options.skillDecisionModel,
      ).run(authoringInput));
  const authored = toSkillCreateAuthoringResult(
    SkillCreateAuthoringResultSchema.parse(
      await createRunner({
        candidateSkills: input.candidateSkills,
        decision,
        signal: input,
        ...source,
      }),
    ),
  );
  const service =
    options.skillManagementServiceFactory?.({ agentId }) ??
    createDefaultSkillManagementService(options);

  try {
    let createdSkill: SkillDetail | undefined;
    const skillMaintenanceService = createSkillManagementService({
      createSkill: async () => {
        const skill = await service.createSkill({
          agentId,
          bodyMarkdown: authored.bodyMarkdown,
          description: authored.description,
          name: authored.name,
          sourceAgentDocumentId: source.sourceAgentDocumentId,
          title: authored.title ?? authored.name,
        });
        createdSkill = skill;

        return {
          skillDocumentId: skill.bundle.agentDocumentId,
          summary: authored.reason,
        };
      },
    });
    await skillMaintenanceService.createSkill({
      evidenceRefs: [],
      idempotencyKey: `same-turn-skill:create:${authored.name}`,
      input: {
        bodyMarkdown: authored.bodyMarkdown,
        description: authored.description,
        name: authored.name,
        title: authored.title ?? authored.name,
        userId: options.userId,
      },
    });

    return {
      decision,
      detail: authored.reason ?? `Created skill ${authored.name}.`,
      status: 'applied',
      target: createdSkill ? toSkillActionTarget(createdSkill) : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('already exists')) {
      return { decision, detail: error.message, status: 'skipped' };
    }

    throw error;
  }
};

export const runSkillManagementAction = async (
  input: SkillManagementActionInput,
  options: SkillManagementActionHandlerOptions,
  decision: SkillManagementDecision,
): Promise<SkillManagementActionResult> => {
  if (decision.action === 'reject') {
    return {
      decision,
      detail: decision.reason ?? 'Skill-management decision was rejected.',
      status: 'skipped',
    };
  }

  if (decision.action === 'noop') {
    return {
      decision,
      detail: decision.reason ?? 'Skill-management decision was noop.',
      status: 'skipped',
    };
  }

  if (!input.agentId) {
    return {
      decision,
      detail: 'Missing agentId for skill-management action.',
      status: 'skipped',
    };
  }

  if (input.message.trim().length === 0) {
    return {
      decision,
      detail: 'Missing skill-management action message.',
      status: 'skipped',
    };
  }

  if (isMaintainerDecision(decision)) {
    return runMaintainerWorkflow(input, options, decision);
  }

  return runCreateWorkflow(input, options, decision);
};

/**
 * Executes one skill-management action by collecting evidence, deciding, and applying mutations.
 *
 * Triggering workflow:
 *
 * {@link defineSkillManagementActionHandler}
 *   -> `action.skill-management.handle`
 *     -> {@link executeSkillManagementAction}
 *       -> {@link executeSkillManagementDecision}
 *
 * Upstream:
 * - {@link defineSkillManagementActionHandler}
 *
 * Downstream:
 * - {@link executeSkillManagementDecision}
 * - {@link runMaintainerWorkflow}
 * - {@link runCreateWorkflow}
 */
export const executeSkillManagementAction = async (
  action: BaseAction,
  options: SkillManagementActionHandlerOptions,
  context: RuntimeProcessorContext,
): Promise<ExecutorResult> => {
  const startedAt = Date.now();
  const idempotencyKey =
    'idempotencyKey' in action.payload && typeof action.payload.idempotencyKey === 'string'
      ? action.payload.idempotencyKey
      : undefined;

  try {
    if (await hasAppliedActionIdempotency(context, idempotencyKey)) {
      // The planner emits a stable idempotency key per source message and target domain. If the
      // same feedback source is reprocessed in the same runtime scope, we skip before decision
      // generation to avoid creating or mutating the same skill twice.
      return toSkippedExecutorResult({
        actionId: action.actionId,
        decision: createNoopDecision('skill-management action already applied'),
        detail: 'Skill-management action already applied.',
        startedAt,
      });
    }

    if (!isSkillManagementAction(action)) {
      return toSkippedExecutorResult({
        actionId: action.actionId,
        decision: createNoopDecision('unsupported skill-management action type'),
        detail: 'Unsupported skill-management action type.',
        startedAt,
      });
    }

    const message = action.payload.message?.trim();

    if (!message) {
      return toSkippedExecutorResult({
        actionId: action.actionId,
        decision: createNoopDecision('missing skill-management action message'),
        detail: 'Missing skill-management action message.',
        startedAt,
      });
    }

    if (!action.payload.agentId) {
      return toSkippedExecutorResult({
        actionId: action.actionId,
        decision: createNoopDecision('missing skill-management action agentId'),
        detail: 'Missing agentId for skill-management action.',
        startedAt,
      });
    }

    const candidateSkills = await resolveSkillDecisionCandidates(options, action.payload.agentId);
    const recordedIntent = await readRecordedSkillIntentForExecution(options, action, context);
    const sameTurnDocumentEvidence = await collectHintedSameTurnDocumentEvidence(
      {
        agentId: action.payload.agentId,
        messageId: action.payload.messageId,
        scopeKey: context.scopeKey,
        topicId: action.payload.topicId,
      },
      options,
    );
    const evidence = [
      ...(action.payload.evidence ?? []),
      ...sameTurnDocumentEvidence,
      ...createRecordedSkillIntentEvidence(recordedIntent),
    ];
    const runnerInput = {
      agentId: action.payload.agentId,
      ...(candidateSkills.length > 0 ? { candidateSkills } : {}),
      ...(evidence.length > 0 ? { evidence } : {}),
      feedbackHint: action.payload.feedbackHint,
      message,
      messageId: action.payload.messageId,
      reason: action.payload.reason,
      serializedContext: action.payload.serializedContext,
      topicId: action.payload.topicId,
    };
    const decisionResult = await executeSkillManagementDecision({
      decide: options.skillDecisionRunner ?? createSkillDecisionRunner(options),
      payload: {
        agentId: action.payload.agentId,
        ...(candidateSkills.length > 0 ? { candidateSkills } : {}),
        ...(evidence.length > 0 ? { evidence } : {}),
        feedbackMessage: message,
        messageId: action.payload.messageId,
        scopeKey: context.scopeKey,
        topicId: action.payload.topicId,
        turnContext: action.payload.serializedContext,
      },
      selfIterationEnabled: options.selfIterationEnabled,
    });

    if (decisionResult.status === 'skipped') {
      return toSkippedExecutorResult({
        actionId: action.actionId,
        decision: createNoopDecision(decisionResult.reason),
        detail: decisionResult.reason,
        startedAt,
      });
    }

    const result = await runSkillManagementAction(runnerInput, options, decisionResult.decision);

    if (result.status === 'applied') {
      await markAppliedActionIdempotency(context, idempotencyKey);

      return {
        actionId: action.actionId,
        attempt: finalizeAttempt(startedAt, 'succeeded'),
        detail: result.detail,
        output: { decision: result.decision, ...(result.target ? { target: result.target } : {}) },
        status: 'applied',
      };
    }

    if (result.status === 'failed') {
      return toExecutorError(
        action.actionId,
        new Error(result.detail ?? 'Skill-management action failed.'),
        startedAt,
      );
    }

    return {
      actionId: action.actionId,
      attempt: finalizeAttempt(startedAt, 'skipped'),
      detail: result.detail,
      output: { decision: result.decision },
      status: 'skipped',
    };
  } catch (error) {
    return toExecutorError(action.actionId, error, startedAt);
  }
};

/**
 * Creates the action handler that writes document-backed skills for skill-domain feedback.
 *
 * Triggering workflow:
 *
 * {@link createFeedbackActionPlannerSignalHandler}
 *   -> `action.skill-management.handle`
 *     -> {@link defineSkillManagementActionHandler}
 *
 * Upstream:
 * - {@link createFeedbackActionPlannerSignalHandler}
 *
 * Downstream:
 * - {@link executeSkillManagementAction}
 * - {@link SkillManagementDocumentService}
 */
export const defineSkillManagementActionHandler = (
  options: SkillManagementActionHandlerOptions,
) => {
  return defineActionHandler(
    AGENT_SIGNAL_POLICY_ACTION_TYPES.skillManagementHandle,
    'handler.skill-management.handle',
    async (action, context: RuntimeProcessorContext) => {
      return executeSkillManagementAction(action, options, context);
    },
  );
};

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
  AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE,
  AGENT_SKILL_REFINE_SYSTEM_ROLE,
  createAgentSkillConsolidatePrompt,
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
import { createMarkdownEditorSnapshot } from '@/server/services/agentDocuments/headlessEditor';
import { AgentDocumentVfsService } from '@/server/services/agentDocumentVfs';
import {
  createSkillTree,
  getSkillFolder,
} from '@/server/services/agentDocumentVfs/mounts/skills/providers/providerSkillsAgentDocumentUtils';
import { AgentSignalProcedureInspector } from '@/server/services/agentSignal/procedure';
import { redisPolicyStateStore } from '@/server/services/agentSignal/store/adapters/redis/policyStateStore';
import { SkillMaintainerService } from '@/server/services/skillMaintainer/SkillMaintainerService';
import { SkillReferenceResolver } from '@/server/services/skillMaintainer/SkillReferenceResolver';
import { VfsSkillPackageAdapter } from '@/server/services/skillMaintainer/VfsSkillPackageAdapter';

import type { RuntimeProcessorContext } from '../../../runtime/context';
import { defineActionHandler } from '../../../runtime/middleware';
import { hasAppliedActionIdempotency, markAppliedActionIdempotency } from '../../actionIdempotency';
import type { ActionSkillManagementHandle, AgentSignalFeedbackEvidence } from '../../types';
import { AGENT_SIGNAL_POLICY_ACTION_TYPES } from '../../types';
import { createFeedbackActionPlannerSignalHandler } from '../feedbackAction';

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
  /** Existing skills the decision agent may target by package id. */
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
  /** Optional file paths that should be read before refinement or consolidation. */
  requiredReads?: string[];
  /** Optional target skill identifiers selected by the decision model. */
  targetSkillIds?: string[];
}

export interface SkillManagementActionResult {
  decision: SkillManagementDecision;
  detail?: string;
  status: 'applied' | 'failed' | 'skipped';
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
  selfIterationEnabled: boolean;
  skillCandidateSkillsFactory?: (input: {
    agentId: string;
  }) => Promise<SkillManagementCandidateSkill[]>;
  skillDecisionModel?: SkillManagementAgentModelConfig;
  skillDecisionRunner?: (input: SkillManagementSignalPayload) => Promise<unknown>;
  skillMaintainerRunner?: (input: SkillMaintainerWorkflowInput) => Promise<unknown>;
  skillMaintainerServiceFactory?: (input: {
    agentId: string;
  }) => SkillMaintainerFileOperationService;
  userId: string;
}

export interface SkillDecisionDocumentOutcome {
  documentId: string;
  relation?: string;
  summary?: string;
}

export interface SkillDecisionCandidateDocument {
  documentId: string;
  filename?: string;
  title?: string;
}

export interface SkillDecisionDocumentSnapshot {
  content?: string;
  documentId: string;
  filename?: string;
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
  readDocument: (input: { documentId: string }) => Promise<SkillDecisionDocumentSnapshot>;
}

export interface SkillManagementAgentModelConfig {
  model: string;
  provider: string;
}

export interface SkillMaintainerOperation {
  arguments: Record<string, unknown>;
  name: 'removeSkillFile' | 'updateSkill' | 'writeSkillFile';
}

export interface SkillMaintainerWorkflowInput {
  decision: SkillManagementDecision;
  signal: SkillManagementActionInput;
  targetSkills: Array<{
    content: string;
    id: string;
    metadata: Record<string, unknown>;
  }>;
  type: 'consolidate' | 'refine';
}

export interface SkillMaintainerWorkflowResult {
  confidence?: number;
  operations: SkillMaintainerOperation[];
  proposedLifecycleActions?: Array<Record<string, unknown>>;
  reason?: string;
}

export interface SkillMaintainerFileOperationService {
  readSkillFile: (input: { path: string; skillRef: string }) => Promise<string>;
  removeSkillFile: (input: { path: string; skillRef: string }) => Promise<void>;
  updateSkill: (input: { content: string; path: string; skillRef: string }) => Promise<void>;
  writeSkillFile: (input: { content: string; path: string; skillRef: string }) => Promise<void>;
}

const SkillManagementDecisionSchema = z.object({
  action: z.enum(['create', 'refine', 'consolidate', 'noop', 'reject']),
  confidence: z.number().min(0).max(1).nullable(),
  documentRefs: z.array(z.string()).default([]),
  reason: z.string().nullable(),
  requiredReads: z.array(z.string()),
  targetSkillIds: z.array(z.string()),
});

const SkillMaintainerOperationSchema = z.object({
  arguments: z.record(z.string(), z.unknown()),
  name: z.enum(['updateSkill', 'writeSkillFile', 'removeSkillFile']),
});

const SkillMaintainerWorkflowResultSchema = z.object({
  confidence: z.number().min(0).max(1).nullable().default(null),
  operations: z.array(SkillMaintainerOperationSchema),
  proposedLifecycleActions: z.array(z.record(z.string(), z.unknown())).default([]),
  reason: z.string().nullable().default(null),
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
      targetSkillIds: { items: { type: 'string' }, type: 'array' },
    },
    required: ['action', 'confidence', 'documentRefs', 'reason', 'requiredReads', 'targetSkillIds'],
    type: 'object',
  },
  strict: true,
} satisfies GenerateObjectSchema;

const SkillMaintainerWorkflowResultBaseGenerateObjectSchema = {
  schema: {
    additionalProperties: false,
    properties: {
      confidence: {
        anyOf: [{ maximum: 1, minimum: 0, type: 'number' }, { type: 'null' }],
      },
      operations: {
        items: {
          additionalProperties: false,
          properties: {
            arguments: {
              additionalProperties: false,
              properties: {
                content: { type: ['string', 'null'] },
                path: { type: 'string' },
                skillRef: { type: 'string' },
              },
              required: ['skillRef', 'path', 'content'],
              type: 'object',
            },
            name: {
              enum: ['updateSkill', 'writeSkillFile', 'removeSkillFile'],
              type: 'string',
            },
          },
          required: ['arguments', 'name'],
          type: 'object',
        },
        type: 'array',
      },
      proposedLifecycleActions: {
        items: {
          additionalProperties: false,
          properties: {
            reason: { type: ['string', 'null'] },
            type: { type: 'string' },
          },
          required: ['type', 'reason'],
          type: 'object',
        },
        type: 'array',
      },
      reason: { type: ['string', 'null'] },
    },
    required: ['confidence', 'operations', 'proposedLifecycleActions', 'reason'],
    type: 'object',
  },
  strict: true,
} satisfies Omit<GenerateObjectSchema, 'name'>;

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
  const targetSkillIds = getStringArray(record.targetSkillIds);

  return {
    action,
    ...(confidence === undefined ? {} : { confidence }),
    ...(documentRefs === undefined ? {} : { documentRefs }),
    ...(reason === undefined ? {} : { reason }),
    ...(requiredReads === undefined ? {} : { requiredReads }),
    ...(targetSkillIds === undefined ? {} : { targetSkillIds }),
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
      description: 'Read one agent document by document id for attribution before deciding.',
      name: 'readDocument',
      parameters: {
        additionalProperties: false,
        properties: {
          documentId: { type: 'string' },
        },
        required: ['documentId'],
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
    const documentId = toNullableString(args.documentId);
    if (!documentId) return { error: 'documentId is required' };

    return input.tools.readDocument({ documentId });
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
              metadata: { trigger: RequestTrigger.Memory },
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
      trigger: RequestTrigger.Memory,
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
 * Handles one skill-domain Agent Signal payload.
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
export const handleSkillManagementSignal = async (input: {
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
  ...(value.targetSkillIds.length === 0 ? {} : { targetSkillIds: value.targetSkillIds }),
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
 * - Agent-scoped candidate ids that are package names for `targetSkillIds`
 */
export const collectAgentSkillDecisionCandidates = (
  documents: AgentDocument[],
): SkillManagementCandidateSkill[] => {
  const candidates: SkillManagementCandidateSkill[] = [];

  for (const document of documents) {
    const folder = getSkillFolder(documents, 'agent', document.filename);

    if (!folder || folder.id !== document.id) {
      continue;
    }

    candidates.push({
      id: document.filename,
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
        documentId: document.documentId,
        filename: document.filename,
        title: document.title,
      }));
    },
    listSameTurnDocumentOutcomes: async ({ messageId, scopeKey }) => {
      if (!scopeKey) return [];

      const snapshot = await inspector.inspectScope(scopeKey);

      return snapshot.receipts
        .filter((receipt) => receipt.domainKey.startsWith('document:'))
        .filter((receipt) => !messageId || receipt.messageId === messageId)
        .flatMap((receipt) =>
          (receipt.relatedObjects ?? [])
            .filter((object) => object.objectType === 'document')
            .map((object) => ({
              documentId: object.objectId,
              relation: object.relation,
              summary: receipt.summary,
            })),
        );
    },
    readDocument: async ({ documentId }) => {
      const snapshot = await agentDocumentsService.getDocumentSnapshotById(documentId);
      if (!snapshot) return { documentId };

      return {
        content: snapshot.content,
        documentId,
        filename: snapshot.filename,
        title: snapshot.title,
      };
    },
  };
};

const toSkillMaintainerWorkflowResult = (
  value: z.infer<typeof SkillMaintainerWorkflowResultSchema>,
): SkillMaintainerWorkflowResult => ({
  operations: value.operations,
  ...(value.confidence === null ? {} : { confidence: value.confidence }),
  ...(value.proposedLifecycleActions.length === 0
    ? {}
    : { proposedLifecycleActions: value.proposedLifecycleActions }),
  ...(value.reason === null ? {} : { reason: value.reason }),
});

class SkillManagementDecisionAgentService {
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
      tools: createDefaultSkillDecisionToolset(this.db, this.userId),
    });

    return toSkillManagementDecision(
      SkillManagementDecisionSchema.parse({
        confidence: result.confidence ?? null,
        documentRefs: result.documentRefs ?? [],
        reason: result.reason ?? null,
        requiredReads: result.requiredReads ?? [],
        targetSkillIds: result.targetSkillIds ?? [],
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
      { metadata: { trigger: RequestTrigger.Memory } },
    );

    return toSkillMaintainerWorkflowResult(SkillMaintainerWorkflowResultSchema.parse(result));
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

/**
 * Normalizes feedback text into a skill package name.
 *
 * Before:
 * - "This review workflow should become a reusable checklist."
 *
 * After:
 * - "review-workflow-reusable-checklist"
 */
export const normalizeSkillPackageName = (message: string) => {
  const words = message
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 2 && !['should', 'this', 'that', 'become'].includes(word))
    .slice(0, 5);

  return words.length > 0 ? words.join('-') : 'agent-signal-skill';
};

export const createSkillDecisionRunner = (options: SkillManagementActionHandlerOptions) => {
  const agent = new SkillManagementDecisionAgentService(
    options.db,
    options.userId,
    options.skillDecisionModel,
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

const toSkillTitle = (skillName: string) =>
  skillName
    .split('-')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');

const toSkillContent = (input: SkillManagementActionInput, skillName: string) => {
  const evidence = input.evidence?.map((item) => `- ${item.cue}: ${item.excerpt}`).join('\n');
  const context = input.serializedContext ? `\n\n## Context\n${input.serializedContext}` : '';
  const evidenceBlock = evidence ? `\n\n## Evidence\n${evidence}` : '';
  const reason = input.reason ? `\n\n## Reason\n${input.reason}` : '';

  return `# ${toSkillTitle(skillName)}

## Trigger
Use when similar feedback or work requires this reusable procedure.

## Procedure
- Apply the workflow requested in the feedback.
- Preserve concrete checks, ordering, and verification criteria from the source turn.
- Re-check the result before responding.

## Source Feedback
${input.message}${reason}${evidenceBlock}${context}
`;
};

const createDefaultSkillMaintainerService = (
  options: SkillManagementActionHandlerOptions,
  agentId: string,
): SkillMaintainerFileOperationService => {
  const vfs = new AgentDocumentVfsService(options.db, options.userId);
  const agentDocumentModel = new AgentDocumentModel(options.db, options.userId);
  const ctx = { agentId };

  return new SkillMaintainerService({
    adapter: new VfsSkillPackageAdapter({
      delete: async (path) => {
        await vfs.delete(path, ctx);
      },
      list: (path) => vfs.list(path, ctx),
      read: async (path) => {
        return (await vfs.read(path, ctx)).content;
      },
      write: async (path, content) => {
        await vfs.write(path, content, ctx, { createMode: 'if-missing' });
      },
    }),
    resolver: new SkillReferenceResolver({
      findAgentSkillById: async (id) => {
        const skillFolder = getSkillFolder(
          await agentDocumentModel.findByAgent(agentId),
          'agent',
          id,
        );

        return skillFolder ? { id } : undefined;
      },
    }),
  });
};

const getSkillTargets = (decision: SkillManagementDecision) => decision.targetSkillIds ?? [];

const isMaintainerDecision = (
  decision: SkillManagementDecision,
): decision is SkillManagementDecision & { action: 'consolidate' | 'refine' } =>
  decision.action === 'refine' || decision.action === 'consolidate';

// TODO(@nekomeowww): Split the maintainer workflow orchestration out of this action file.
// This module currently owns decision schemas, LLM runners, VFS-backed service construction,
// file-operation application, and create/refine/consolidate action orchestration. Keeping all
// of that here makes the action handler harder to scan and will make future maintainer rules
// risky to add because model contracts and file mutation behavior change in the same module.
// Expected shape: keep this file focused on action input/output, idempotency, and top-level
// dispatch; move refine/consolidate runner setup, target reads, policy checks, and operation
// application into a small `skillMaintainerWorkflow` module with focused tests.
const readTargetSkills = async (
  service: SkillMaintainerFileOperationService,
  skillRefs: string[],
) => {
  return Promise.all(
    skillRefs.map(async (skillRef) => ({
      content: await service.readSkillFile({ path: 'SKILL.md', skillRef }),
      id: skillRef,
      metadata: {},
    })),
  );
};

const getOperationStringArgument = (
  operation: SkillMaintainerOperation,
  key: 'content' | 'path' | 'skillRef',
  fallback?: string,
) => {
  const value = operation.arguments[key];

  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
};

const applyMaintainerOperations = async (
  service: SkillMaintainerFileOperationService,
  operations: SkillMaintainerOperation[],
  targetSkillIds: string[],
) => {
  const allowedSkillRefs = new Set(targetSkillIds);
  const defaultSkillRef = targetSkillIds[0];

  if (!defaultSkillRef) {
    throw new Error('Invalid maintainer workflow: missing target skill refs');
  }

  const normalizedOperations = operations.map((operation) => {
    const skillRef = getOperationStringArgument(operation, 'skillRef', defaultSkillRef);
    const path = getOperationStringArgument(operation, 'path');

    if (!skillRef || !path) {
      throw new Error(`Invalid ${operation.name} operation: missing skillRef or path`);
    }

    if (!allowedSkillRefs.has(skillRef)) {
      throw new Error(
        `Invalid ${operation.name} operation: skillRef is not a decision target: ${skillRef}`,
      );
    }

    return { operation, path, skillRef };
  });

  for (const { operation, path, skillRef } of normalizedOperations) {
    if (operation.name === 'removeSkillFile') {
      await service.removeSkillFile({ path, skillRef });
      continue;
    }

    const content = getOperationStringArgument(operation, 'content');

    if (!content) {
      throw new Error(`Invalid ${operation.name} operation: missing content`);
    }

    if (operation.name === 'updateSkill') {
      await service.updateSkill({ content, path, skillRef });
      continue;
    }

    await service.writeSkillFile({ content, path, skillRef });
  }
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

  const targetSkillIds = getSkillTargets(decision);
  const minimumTargets = decision.action === 'consolidate' ? 2 : 1;

  if (targetSkillIds.length < minimumTargets) {
    return {
      decision,
      detail: `Skill-management ${decision.action} requires targetSkillIds from the decision agent.`,
      status: 'skipped',
    };
  }

  const service =
    options.skillMaintainerServiceFactory?.({ agentId: input.agentId }) ??
    createDefaultSkillMaintainerService(options, input.agentId);
  const workflowRunner =
    options.skillMaintainerRunner ??
    ((workflowInput: SkillMaintainerWorkflowInput) =>
      new SkillMaintainerWorkflowAgentService(
        options.db,
        options.userId,
        options.skillDecisionModel,
      ).run(workflowInput));
  const targetSkills = await readTargetSkills(service, targetSkillIds);
  const workflowResult = toSkillMaintainerWorkflowResult(
    SkillMaintainerWorkflowResultSchema.parse(
      await workflowRunner({
        decision,
        signal: input,
        targetSkills,
        type: decision.action,
      }),
    ),
  );

  try {
    await applyMaintainerOperations(service, workflowResult.operations, targetSkillIds);
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
  };
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

  const skillName = normalizeSkillPackageName(input.message);
  const snapshot = await createMarkdownEditorSnapshot(toSkillContent(input, skillName));

  try {
    await createSkillTree({
      agentDocumentModel: new AgentDocumentModel(options.db, options.userId),
      agentId: input.agentId,
      content: snapshot.content,
      editorData: snapshot.editorData,
      namespace: 'agent',
      skillName,
    });

    return { decision, detail: `Created skill ${skillName}.`, status: 'applied' };
  } catch (error) {
    if (error instanceof Error && error.message.includes('already exists')) {
      return { decision, detail: error.message, status: 'skipped' };
    }

    throw error;
  }
};

export const handleSkillManagementAction = async (
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
    const runnerInput = {
      agentId: action.payload.agentId,
      ...(candidateSkills.length > 0 ? { candidateSkills } : {}),
      evidence: action.payload.evidence,
      feedbackHint: action.payload.feedbackHint,
      message,
      messageId: action.payload.messageId,
      reason: action.payload.reason,
      serializedContext: action.payload.serializedContext,
      topicId: action.payload.topicId,
    };
    const decisionResult = await handleSkillManagementSignal({
      decide: options.skillDecisionRunner ?? createSkillDecisionRunner(options),
      payload: {
        agentId: action.payload.agentId,
        ...(candidateSkills.length > 0 ? { candidateSkills } : {}),
        evidence: action.payload.evidence,
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
        output: { decision: result.decision },
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
 * - {@link runSkillManagementAction}
 * - {@link createSkillTree}
 */
export const defineSkillManagementActionHandler = (
  options: SkillManagementActionHandlerOptions,
) => {
  return defineActionHandler(
    AGENT_SIGNAL_POLICY_ACTION_TYPES.skillManagementHandle,
    'handler.skill-management.handle',
    async (action, context: RuntimeProcessorContext) => {
      return handleSkillManagementAction(action, options, context);
    },
  );
};

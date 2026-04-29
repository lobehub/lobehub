import type {
  AgenticAttempt,
  BaseAction,
  ExecutorResult,
  SignalAttempt,
} from '@lobechat/agent-signal';
import { DEFAULT_MINI_SYSTEM_AGENT_ITEM } from '@lobechat/const';
import type { GenerateObjectSchema } from '@lobechat/model-runtime';
import {
  AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE,
  AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE,
  AGENT_SKILL_REFINE_SYSTEM_ROLE,
  createAgentSkillConsolidatePrompt,
  createAgentSkillManagerDecisionPrompt,
  createAgentSkillRefinePrompt,
} from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import { z } from 'zod';

import type { AgentDocument } from '@/database/models/agentDocuments';
import { AgentDocumentModel } from '@/database/models/agentDocuments';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { createMarkdownEditorSnapshot } from '@/server/services/agentDocuments/headlessEditor';
import { AgentDocumentVfsService } from '@/server/services/agentDocumentVfs';
import {
  createSkillTree,
  getSkillFolder,
} from '@/server/services/agentDocumentVfs/mounts/skills/providers/providerSkillsAgentDocumentUtils';
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
  /** Optional topic where the feedback happened. */
  topicId?: string;
  /** Optional relevant turn summary. */
  turnContext?: string;
}

export type SkillManagementDecisionAction = 'consolidate' | 'create' | 'noop' | 'refine';

/**
 * Normalized result returned by the skill-management decision step.
 */
export interface SkillManagementDecision {
  /** The v1.2 skill-management action selected for this feedback. */
  action: SkillManagementDecisionAction;
  /** Optional confidence score from the decision model. */
  confidence?: number;
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
  action: z.enum(['create', 'refine', 'consolidate', 'noop']),
  confidence: z.number().min(0).max(1).nullable(),
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
      action: { enum: ['create', 'refine', 'consolidate', 'noop'], type: 'string' },
      confidence: {
        anyOf: [{ maximum: 1, minimum: 0, type: 'number' }, { type: 'null' }],
      },
      reason: { type: ['string', 'null'] },
      requiredReads: { items: { type: 'string' }, type: 'array' },
      targetSkillIds: { items: { type: 'string' }, type: 'array' },
    },
    required: ['action', 'confidence', 'reason', 'requiredReads', 'targetSkillIds'],
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
            arguments: { additionalProperties: {}, type: 'object' },
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
        items: { additionalProperties: {}, type: 'object' },
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
  value === 'create' || value === 'refine' || value === 'consolidate' || value === 'noop';

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
  const reason = typeof record.reason === 'string' ? record.reason : undefined;
  const requiredReads = getStringArray(record.requiredReads);
  const targetSkillIds = getStringArray(record.targetSkillIds);

  return {
    action,
    ...(confidence === undefined ? {} : { confidence }),
    ...(reason === undefined ? {} : { reason }),
    ...(requiredReads === undefined ? {} : { requiredReads }),
    ...(targetSkillIds === undefined ? {} : { targetSkillIds }),
  };
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

  const decision = normalizeSkillManagementDecision(await input.decide(input.payload));

  return { decision, status: 'decided' as const };
};

const toSkillManagementDecision = (
  value: z.infer<typeof SkillManagementDecisionSchema>,
): SkillManagementDecision => ({
  action: value.action,
  ...(value.confidence === null ? {} : { confidence: value.confidence }),
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

    const result = await modelRuntime.generateObject(
      {
        messages: [
          { content: AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE, role: 'system' },
          {
            content: createAgentSkillManagerDecisionPrompt({
              agentId: input.agentId,
              ...(candidateSkills.length > 0 ? { candidateSkills } : {}),
              evidence: input.evidence ?? [],
              feedbackMessage: input.feedbackMessage,
              topicId: input.topicId,
              turnContext: input.turnContext,
            }),
            role: 'user',
          },
        ] as never[],
        model: this.modelConfig.model,
        schema: SkillManagementDecisionGenerateObjectSchema,
      },
      { metadata: { trigger: RequestTrigger.Memory } },
    );

    return toSkillManagementDecision(SkillManagementDecisionSchema.parse(result));
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

  await applyMaintainerOperations(service, workflowResult.operations, targetSkillIds);

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

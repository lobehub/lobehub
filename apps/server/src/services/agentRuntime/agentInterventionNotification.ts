import { DEFAULT_SECURITY_BLACKLIST, InterventionChecker } from '@lobechat/agent-runtime';
import {
  type ChatToolPayload,
  classifyToolInterventionPresentation,
  type MessageMapScope,
} from '@lobechat/types';

import {
  deriveAgentInterventionActivityKey,
  hashAgentInterventionRequestRevision,
} from '@/business/server/agent-run/agentInterventionIdentity';
import type {
  AgentInterventionAllowedAction,
  AgentInterventionReviewDetail,
  NotifyAgentInterventionItem,
  NotifyAgentInterventionRequiredParams,
} from '@/business/server/agent-run/agentInterventionReview';
import { getAgentMarketplaceInterventionReview } from '@/business/server/agent-run/executeCustomIntervention';

const MAX_SHORT_TEXT = 200;
const MAX_LONG_TEXT = 1000;

const boundedString = (value: unknown, max = MAX_SHORT_TEXT): string | undefined => {
  if (typeof value !== 'string') return;
  const normalized = value.trim();
  if (!normalized) return;
  return normalized.slice(0, max);
};

const parseArguments = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const boundedStringList = (value: unknown, maxItems = 8): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => boundedString(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
};

const MESSAGE_MAP_SCOPES = new Set<MessageMapScope>([
  'main',
  'thread',
  'group',
  'group_agent',
  'group_agent_builder',
  'page',
  'task',
  'agent_builder',
  'sub_agent',
]);

const APPROVAL_MODES = new Set<NotifyAgentInterventionRequiredParams['approvalMode']>([
  'allow-list',
  'auto-run',
  'headless',
  'manual',
]);

const messageMapScope = (value: unknown): MessageMapScope | undefined =>
  typeof value === 'string' && MESSAGE_MAP_SCOPES.has(value as MessageMapScope)
    ? (value as MessageMapScope)
    : undefined;

const approvalMode = (value: unknown): NotifyAgentInterventionRequiredParams['approvalMode'] =>
  typeof value === 'string' &&
  APPROVAL_MODES.has(value as NotifyAgentInterventionRequiredParams['approvalMode'])
    ? (value as NotifyAgentInterventionRequiredParams['approvalMode'])
    : 'manual';

const buildQuestionDetail = (
  args: Record<string, unknown>,
): Extract<AgentInterventionReviewDetail, { type: 'question' }> => {
  const questions = Array.isArray(args.questions) ? args.questions : [];

  return {
    // The shared Web AskUser form exposes both whole-form freeform and a
    // supplemental note. Persist these as explicit capabilities so native
    // clients never infer them from the presence of questions.
    answerPolicy: { allowFreeform: true, allowSupplement: true },
    questions: questions
      .filter((question): question is Record<string, unknown> =>
        Boolean(question && typeof question === 'object' && !Array.isArray(question)),
      )
      .slice(0, 4)
      .map((question, questionIndex) => {
        const rawOptions = Array.isArray(question.options) ? question.options : [];
        return {
          // Every question in the shared AskUser surface has the trailing
          // "write your own" row; make that server-authored policy explicit.
          allowCustomAnswer: true,
          header: boundedString(question.header),
          id:
            boundedString(question.id) ??
            boundedString(question.question) ??
            `question_${questionIndex + 1}`,
          multiple: question.multiSelect === true || question.multiple === true,
          options: rawOptions
            .filter((option): option is Record<string, unknown> =>
              Boolean(option && typeof option === 'object' && !Array.isArray(option)),
            )
            .slice(0, 8)
            .map((option, optionIndex) => ({
              description: boundedString(option.description, MAX_LONG_TEXT),
              id:
                boundedString(option.id) ??
                boundedString(option.value) ??
                boundedString(option.label) ??
                `option_${optionIndex + 1}`,
              label:
                boundedString(option.label) ??
                boundedString(option.value) ??
                `Option ${optionIndex + 1}`,
            })),
          question:
            boundedString(question.question, MAX_LONG_TEXT) ?? `Question ${questionIndex + 1}`,
        };
      }),
    title: boundedString(args.title) ?? boundedString(args.prompt, MAX_LONG_TEXT),
    type: 'question',
  };
};

const revisionFor = (tool: ChatToolPayload) => ({
  // Must exactly match the DB edit/claim CAS: the canonical revision is the
  // SHA-256 of the raw arguments string, without parsing or tool metadata.
  hash: hashAgentInterventionRequestRevision(tool.arguments || ''),
  version: 1,
});

const actionsFor = (
  surface: 'binary' | 'form',
  interactionKind: NotifyAgentInterventionItem['interactionKind'],
  resolvedApprovalMode: NotifyAgentInterventionRequiredParams['approvalMode'],
): AgentInterventionAllowedAction[] => {
  if (surface === 'binary') {
    return [
      'approve_tool',
      ...(resolvedApprovalMode === 'allow-list' ? (['approve_tool_remember'] as const) : []),
      'edit_arguments',
      'reject_continue',
      'stop',
    ];
  }

  if (interactionKind === 'question') {
    // Standard runtime AskUser has Submit / Skip semantics. Cancel is a
    // provider/custom terminal action and has no runtime handler here.
    return ['submit_answers', 'skip_interaction', 'stop'];
  }

  // Web marketplace exposes Submit / Skip / Stop. Keep cancel_interaction in
  // the reserved v2 union, but never advertise it until an operation-wide
  // atomic cancel emitter exists across Web and Mobile.
  return ['submit_custom', 'skip_interaction', 'stop'];
};

/**
 * Direct system actions are an elevated capability, so classification alone
 * is insufficient. Require the exact API to exist in the immutable operation
 * manifest (or a dynamically activated manifest that was durably resolved).
 * Unknown tools and incomplete discovery placeholders remain Review-only.
 */
const hasAuthoritativeApiDefinition = (state: any, tool: ChatToolPayload): boolean => {
  const baseManifestMap = state?.operationToolSet?.manifestMap ?? state?.toolManifestMap ?? {};
  const activatedManifestMap = Object.fromEntries(
    (Array.isArray(state?.activatedStepTools) ? state.activatedStepTools : [])
      .filter(
        (activation: unknown): activation is { id: string; manifest: Record<string, unknown> } =>
          Boolean(
            activation &&
            typeof activation === 'object' &&
            typeof (activation as { id?: unknown }).id === 'string' &&
            (activation as { manifest?: unknown }).manifest &&
            typeof (activation as { manifest?: unknown }).manifest === 'object',
          ),
      )
      .map((activation: { id: string; manifest: Record<string, unknown> }) => [
        activation.id,
        activation.manifest,
      ]),
  );
  const manifest = activatedManifestMap[tool.identifier] ?? baseManifestMap[tool.identifier];

  return Boolean(
    manifest &&
    typeof manifest === 'object' &&
    Array.isArray((manifest as { api?: unknown }).api) &&
    (manifest as { api: unknown[] }).api.some(
      (api) => api && typeof api === 'object' && (api as { name?: unknown }).name === tool.apiName,
    ),
  );
};

interface BuildRuntimeInterventionNotificationParams {
  operationId: string;
  state: any;
  userId: string;
  workspaceId?: string;
}

/**
 * Build the notification-safe snapshot for one sealed runtime approval batch.
 * Raw tool arguments are used only to derive a revision and bounded custom
 * detail; they are never copied into the durable notification contract.
 */
export const buildRuntimeInterventionNotification = async ({
  operationId,
  state,
  userId,
  workspaceId,
}: BuildRuntimeInterventionNotificationParams): Promise<
  NotifyAgentInterventionRequiredParams | undefined
> => {
  const pendingTools: ChatToolPayload[] = Array.isArray(state?.pendingToolsCalling)
    ? state.pendingToolsCalling
    : [];
  const batch = state?.pendingApprovalBatch;
  const toolMessageIds = state?.pendingToolMessageIds;
  const metadata = state?.metadata ?? {};

  if (
    state?.status !== 'waiting_for_human' ||
    !batch?.sealed ||
    typeof batch.id !== 'string' ||
    typeof batch.assistantMessageId !== 'string' ||
    !Number.isInteger(batch.stepIndex) ||
    !toolMessageIds ||
    typeof toolMessageIds !== 'object' ||
    pendingTools.length === 0
  ) {
    return;
  }

  const items: NotifyAgentInterventionItem[] = [];
  const securityBlacklist = state?.securityBlacklist ?? DEFAULT_SECURITY_BLACKLIST;
  const resolvedApprovalMode = approvalMode(state?.userInterventionConfig?.approvalMode);

  for (const tool of pendingTools) {
    const toolMessageId = toolMessageIds[tool.id];
    if (typeof toolMessageId !== 'string' || !toolMessageId) return;

    const args = parseArguments(tool.arguments);
    const { interactionKind, surface } = classifyToolInterventionPresentation(
      tool.identifier,
      tool.apiName,
    );
    const security = InterventionChecker.checkSecurityBlacklist(securityBlacklist, args);
    const item: NotifyAgentInterventionItem = {
      allowedActions: actionsFor(surface, interactionKind, resolvedApprovalMode),
      canonicalToolKey: `${tool.identifier}/${tool.apiName}`,
      interactionKind,
      provider:
        boundedString(state?.modelRuntimeConfig?.provider) ??
        boundedString(metadata?.modelRuntimeConfig?.provider) ??
        boundedString(metadata?.provider),
      requestRevision: revisionFor(tool),
      ...(security.blocked && {
        risk: {
          level: 'critical' as const,
          summary: boundedString(security.reason, MAX_LONG_TEXT) ?? 'Blocked by a security policy',
        },
      }),
      sourceRef: { toolCallId: tool.id, toolMessageId, type: 'runtime' },
      surface,
      summary: `${tool.identifier} / ${tool.apiName}`.slice(0, MAX_SHORT_TEXT),
    };

    if (interactionKind === 'question') {
      item.detail = buildQuestionDetail(args);
    } else if (
      interactionKind === 'custom' &&
      tool.identifier === 'lobe-web-onboarding' &&
      tool.apiName === 'showAgentMarketplace'
    ) {
      const requestId = boundedString(args.requestId) ?? tool.id;
      const categoryHints = boundedStringList(args.categoryHints);
      const agents = await getAgentMarketplaceInterventionReview({
        categoryHints,
        prompt: boundedString(args.prompt, MAX_LONG_TEXT),
        requestId,
        userId,
        workspaceId,
      });
      item.detail = {
        agents: agents
          .map((agent) => ({
            avatar: boundedString(agent.avatar, MAX_LONG_TEXT),
            description: boundedString(agent.description, MAX_LONG_TEXT),
            id: boundedString(agent.id),
            title: boundedString(agent.title),
          }))
          .filter((agent): agent is typeof agent & { id: string; title: string } =>
            Boolean(agent.id && agent.title),
          )
          .slice(0, 50),
        kind: 'agent_marketplace',
        multiple: true,
        title: boundedString(args.prompt, MAX_LONG_TEXT) ?? 'Choose agents',
        type: 'custom',
      };
      item.request = { categoryHints, kind: 'agent_marketplace', requestId };
    }

    items.push(item);
  }

  const allBinary = items.every((item) => item.surface === 'binary');
  const hasSecurityRisk = items.some((item) => item.risk?.level !== undefined);
  const allApisAuthoritative = pendingTools.every((tool) =>
    hasAuthoritativeApiDefinition(state, tool),
  );
  const batchAllowedActions: AgentInterventionAllowedAction[] = allBinary
    ? ['approve_tool', 'reject_continue', 'stop']
    : ['stop'];
  const first = items[0];
  const homogeneous = items.every(
    (item) => item.surface === first.surface && item.interactionKind === first.interactionKind,
  );
  let supersedes: NotifyAgentInterventionRequiredParams['supersedes'];
  if (batch.supersedes) {
    const previousToolCallIds = batch.supersedes.toolCallIds;
    const pendingToolCallIds = pendingTools.map((tool) => tool.id);
    const exactMembers =
      Array.isArray(previousToolCallIds) &&
      previousToolCallIds.length === pendingToolCallIds.length &&
      new Set(previousToolCallIds).size === previousToolCallIds.length &&
      previousToolCallIds.every((toolCallId: unknown) =>
        pendingToolCallIds.includes(toolCallId as string),
      );
    if (
      typeof batch.supersedes.batchId !== 'string' ||
      !batch.supersedes.batchId ||
      typeof batch.supersedes.operationId !== 'string' ||
      !batch.supersedes.operationId ||
      (batch.supersedes.batchId === batch.id && batch.supersedes.operationId === operationId) ||
      !exactMembers
    ) {
      throw new Error('Invalid superseded intervention batch identity');
    }
    supersedes = {
      activityKey: deriveAgentInterventionActivityKey({
        batchId: batch.supersedes.batchId,
        operationId: batch.supersedes.operationId,
        userId,
        workspaceId,
      }),
      batchId: batch.supersedes.batchId,
      operationId: batch.supersedes.operationId,
      toolCallIds: previousToolCallIds,
    };
  }

  return {
    agentId: boundedString(metadata.agentId),
    approvalMode: resolvedApprovalMode,
    batch: {
      activityKey: deriveAgentInterventionActivityKey({
        batchId: batch.id,
        operationId,
        userId,
        workspaceId,
      }),
      allowedActions: batchAllowedActions,
      id: batch.id,
      kind: items.length === 1 ? 'single' : homogeneous ? 'parallel' : 'mixed',
      sealed: true,
      stepIndex: batch.stepIndex,
    },
    context: {
      agentId: boundedString(metadata.agentId),
      assistantMessageId: batch.assistantMessageId,
      groupId: boundedString(metadata.groupId),
      operationId,
      pageId: boundedString(metadata.documentId),
      scope: messageMapScope(metadata.scope),
      sessionId: boundedString(metadata.sessionId),
      taskId: boundedString(metadata.taskId),
      threadId: boundedString(metadata.threadId),
      topicId: boundedString(metadata.topicId),
      triggerMessageId: boundedString(metadata.sourceMessageId),
      workspaceId,
    },
    items,
    summary:
      items.length === 1
        ? `${items[0].summary} requires review`
        : `${items.length} actions require review`,
    systemActionEligibility:
      items.length === 1 && allBinary && !hasSecurityRisk && allApisAuthoritative
        ? 'safe_single_binary'
        : 'review_only',
    ...(supersedes && { supersedes }),
    userId,
    workspaceId,
  };
};

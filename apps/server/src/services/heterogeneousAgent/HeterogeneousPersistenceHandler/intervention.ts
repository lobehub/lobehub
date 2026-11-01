import {
  type AgentInterventionInteractionKind,
  type AgentInterventionProvider,
  type AgentInterventionRequestData,
  sanitizeAgentInterventionRequestForReview,
} from '@lobechat/agent-gateway-client';
import type {
  MainAgentIntent,
  MainAgentInterventionTransition,
} from '@lobechat/heterogeneous-agents';

import {
  deriveAgentInterventionActivityKey,
  hashAgentInterventionRequestRevision,
} from '@/business/server/agent-run/agentInterventionIdentity';
import {
  acknowledgeAgentInterventionProducerResolution,
  type AgentInterventionAllowedAction,
  type AgentInterventionReviewDetail,
  notifyAgentInterventionRequired,
  type NotifyAgentInterventionRequiredParams,
} from '@/business/server/agent-run/agentInterventionReview';

import type { HeterogeneousPersistenceHandlerDeps, OperationState } from './types';

interface StoredHeterogeneousIntervention {
  deadline?: number;
  interactionKind?: AgentInterventionInteractionKind;
  notificationTransition?: MainAgentInterventionTransition;
  operationId: string;
  provider?: AgentInterventionProvider;
  resolutionRequestId?: string;
  summary?: string;
  transition?: MainAgentInterventionTransition;
}

export const HETEROGENEOUS_INTERVENTION_STATE_KEY = 'heterogeneousIntervention';
const MAX_INTERVENTION_SUMMARY_LENGTH = 160;

const interventionSummary = (
  request?: AgentInterventionRequestData,
  reviewDetail?: Extract<
    AgentInterventionReviewDetail,
    { type: 'permission' | 'plan' | 'question' }
  >,
): string => {
  if (reviewDetail?.type === 'question') {
    const question = reviewDetail.questions[0]?.question.trim().replaceAll(/\s+/g, ' ');
    if (question) {
      const characters = [...question];
      return characters.length > MAX_INTERVENTION_SUMMARY_LENGTH
        ? `${characters.slice(0, MAX_INTERVENTION_SUMMARY_LENGTH - 1).join('')}…`
        : question;
    }
  }

  const provider = request?.provider ?? 'heterogeneous-agent';
  const kind = request?.interactionKind ?? 'question';
  const apiName = request?.apiName || 'interaction';
  return `${provider} ${kind}: ${apiName}`.slice(0, MAX_INTERVENTION_SUMMARY_LENGTH);
};

const buildHeterogeneousReviewDetail = (
  request: AgentInterventionRequestData,
): Extract<AgentInterventionReviewDetail, { type: 'permission' | 'plan' | 'question' }> => {
  const parsed = JSON.parse(request.arguments) as {
    questions: Array<{
      header: string;
      multiSelect: boolean;
      options: Array<{ description?: string; id?: string; label: string }>;
      question: string;
    }>;
  };
  const questions = parsed.questions.map((question, questionIndex) => ({
    header: question.header || undefined,
    id: `question_${questionIndex + 1}`,
    multiple: question.multiSelect,
    options: question.options.map((option) => ({
      description: option.description,
      id: option.id ?? option.label,
      label: option.label,
    })),
    question: question.question,
  }));
  const first = questions[0];

  switch (request.interactionKind) {
    case 'permission': {
      return {
        description: first.header,
        options: first.options,
        title: first.question,
        type: 'permission',
      };
    }
    case 'plan': {
      return {
        content: first.question,
        options: first.options,
        title: first.header ?? 'Review plan',
        type: 'plan',
      };
    }
    case 'question': {
      return {
        // The shared AskUser form offers "write your own" on every question,
        // plus whole-form freeform and a supplement note, and the producer's
        // bridge formats all three. Declare them so the claim accepts typed
        // answers instead of treating them as off-list selections.
        answerPolicy: { allowFreeform: true, allowSupplement: true },
        questions: questions.map((question) => ({ ...question, allowCustomAnswer: true })),
        title: first.header,
        type: 'question',
      };
    }
    default: {
      throw new Error('Unsupported heterogeneous intervention kind');
    }
  }
};

const heterogeneousActionsFor = (
  interactionKind: AgentInterventionInteractionKind,
): AgentInterventionAllowedAction[] =>
  interactionKind === 'question'
    ? ['submit_answers', 'skip_interaction']
    : ['select_provider_option', 'skip_interaction'];

export const INTERVENTION_TRANSITIONS = new Set<MainAgentInterventionTransition>([
  'cancelled',
  'pending',
  'resolved',
  'session_ended',
  'timed_out',
]);

export const INTERVENTION_KINDS = new Set<AgentInterventionInteractionKind>([
  'permission',
  'plan',
  'question',
]);

export const INTERVENTION_PROVIDERS = new Set<AgentInterventionProvider>([
  'claude-code',
  'cursor',
  'devin',
  'droid',
  'opencode',
  'qoder',
]);

export async function applyToolIntervention(
  deps: HeterogeneousPersistenceHandlerDeps,
  state: OperationState,
  intent: Extract<MainAgentIntent, { kind: 'setToolIntervention' }>,
  stepIndex: number,
): Promise<void> {
  const toolMsgId = state.toolMsgIdByCallId.get(intent.toolCallId);
  if (!toolMsgId) {
    throw new Error(
      `intervention for unknown toolCallId=${intent.toolCallId} op=${state.operationId}`,
    );
  }

  const reviewRequest = sanitizeAgentInterventionRequestForReview(intent.request);
  const reviewDetail = reviewRequest ? buildHeterogeneousReviewDetail(reviewRequest) : undefined;
  const summary = interventionSummary(intent.request, reviewDetail);
  const transitionKey = `${state.operationId}:${intent.toolCallId}:${intent.transition}`;
  const pendingTransitionKey = `${state.operationId}:${intent.toolCallId}:pending`;
  const requiresPendingReviewNotification =
    !!deps.userId &&
    !state.notifiedInterventionTransitions.has(transitionKey) &&
    !state.notifiedInterventionTransitions.has(pendingTransitionKey);
  if (
    requiresPendingReviewNotification &&
    (!reviewRequest?.interactionKind || !reviewRequest.provider || !reviewDetail)
  ) {
    throw new Error(
      `Unsafe heterogeneous intervention review payload toolCallId=${intent.toolCallId}`,
    );
  }
  const durableState: StoredHeterogeneousIntervention = {
    deadline: intent.request?.deadline,
    interactionKind: intent.request?.interactionKind,
    operationId: state.operationId,
    provider: intent.request?.provider,
    resolutionRequestId: intent.resolutionRequestId,
    summary,
    transition: intent.transition,
  };

  // Persist before any business side effect. The existing JSON plugin-state
  // column carries only correlation metadata; no schema/migration is needed.
  await deps.messageModel.updateMessagePlugin(toolMsgId, {
    intervention: intent.intervention,
  });
  await deps.messageModel.updatePluginState(toolMsgId, {
    [HETEROGENEOUS_INTERVENTION_STATE_KEY]: durableState,
  });

  if (!deps.userId || state.notifiedInterventionTransitions.has(transitionKey)) return;

  if (!state.notifiedInterventionTransitions.has(pendingTransitionKey)) {
    if (!reviewRequest?.interactionKind || !reviewRequest.provider || !reviewDetail) {
      throw new Error(
        `Unsafe heterogeneous intervention review payload toolCallId=${intent.toolCallId}`,
      );
    }
    const toolMessage = await deps.messageModel.findById(toolMsgId);
    const assistantMessageId = toolMessage?.parentId ?? state.main.currentAssistantId;
    if (!assistantMessageId) {
      throw new Error(
        `Missing assistant owner for heterogeneous intervention toolCallId=${intent.toolCallId}`,
      );
    }
    // Heterogeneous callbacks are individually sealed. Include the tool call
    // so two concurrent interventions emitted by one assistant step never
    // claim the same batch identity with conflicting item-0 contents.
    const batchId = `${state.operationId}:${stepIndex}:${assistantMessageId}:${intent.toolCallId}`;
    // The generic Web source bridge reads the same authoritative correlation
    // from the tool row. Stamp it before notify so a card can never appear
    // actionable while its operation/batch locator is still absent.
    await deps.messageModel.updateMessagePlugin(toolMsgId, {
      intervention: {
        ...intent.intervention,
        batchId,
        itemIndex: 0,
        operationId: state.operationId,
        stepIndex,
      },
    });
    const allowedActions = heterogeneousActionsFor(reviewRequest.interactionKind);
    const notification: NotifyAgentInterventionRequiredParams = {
      agentId: state.agentId ?? undefined,
      approvalMode: 'manual',
      batch: {
        activityKey: deriveAgentInterventionActivityKey({
          batchId,
          operationId: state.operationId,
          userId: deps.userId,
          workspaceId: deps.workspaceId,
        }),
        allowedActions: [],
        id: batchId,
        kind: 'single',
        sealed: true,
        stepIndex,
      },
      context: {
        agentId: state.agentId ?? undefined,
        assistantMessageId,
        operationId: state.operationId,
        ...(toolMessage?.threadId && { scope: 'thread' as const, threadId: toolMessage.threadId }),
        topicId: state.topicId,
        workspaceId: deps.workspaceId,
      },
      deadline: reviewRequest.deadline,
      items: [
        {
          allowedActions,
          detail: reviewDetail,
          interactionKind: reviewRequest.interactionKind,
          provider: reviewRequest.provider,
          requestRevision: {
            hash: hashAgentInterventionRequestRevision(intent.request?.arguments ?? ''),
            version: 1,
          },
          sourceRef: {
            operationId: state.operationId,
            toolCallId: intent.toolCallId,
            type: 'heterogeneous',
          },
          summary,
          surface: 'form',
        },
      ],
      summary,
      systemActionEligibility: 'review_only',
      userId: deps.userId,
      workspaceId: deps.workspaceId,
    };
    await notifyAgentInterventionRequired(notification);
    state.notifiedInterventionTransitions.add(pendingTransitionKey);
  }

  if (intent.transition !== 'pending') {
    await acknowledgeAgentInterventionProducerResolution({
      operationId: state.operationId,
      ownerUserId: deps.userId,
      resolutionRequestId: intent.resolutionRequestId,
      status: intent.transition,
      toolCallId: intent.toolCallId,
      workspaceId: deps.workspaceId,
    });
  }
  state.notifiedInterventionTransitions.add(transitionKey);

  // Cold-replica dedupe marker. Cloud's override must still use the same
  // `(operationId, toolCallId, transition)` idempotency key because a process
  // can die after the external side effect but before this best-effort stamp.
  await deps.messageModel.updatePluginState(toolMsgId, {
    [HETEROGENEOUS_INTERVENTION_STATE_KEY]: {
      ...durableState,
      notificationTransition: intent.transition,
    },
  });
}

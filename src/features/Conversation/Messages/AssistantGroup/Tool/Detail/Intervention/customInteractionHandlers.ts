import { UserInteractionIdentifier } from '@lobechat/builtin-tool-user-interaction';
import {
  AgentMarketplaceIdentifier,
  buildAgentMarketplaceToolResult,
} from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
import type { OnboardingAgentMarketplacePickSnapshot } from '@lobechat/types';

import { topicService } from '@/services/topic';

import { installMarketplaceAgents } from './installMarketplaceAgents';

interface SubmitToolInteractionOptions {
  createUserMessage?: boolean;
  pluginState?: Record<string, unknown>;
  toolResultContent?: string;
}

interface CustomInteractionSubmitResult {
  options?: SubmitToolInteractionOptions;
  payload: Record<string, unknown>;
}

interface CustomInteractionContext {
  requestArgs?: Record<string, unknown>;
  topicId?: string | null;
  updateTopicMetadata?: typeof topicService.updateTopicMetadata;
}

type CustomInteractionSubmitHandler = (
  payload: Record<string, unknown>,
  context?: CustomInteractionContext,
) => Promise<CustomInteractionSubmitResult | undefined>;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const pickString = (value: unknown) => (typeof value === 'string' ? value : undefined);

const resolveMarketplacePickBase = (
  payload: Record<string, unknown>,
  requestArgs?: Record<string, unknown>,
) => {
  const requestId = pickString(payload.requestId) ?? pickString(requestArgs?.requestId);
  if (!requestId) return;

  const categoryHints = isStringArray(payload.categoryHints)
    ? payload.categoryHints
    : isStringArray(requestArgs?.categoryHints)
      ? requestArgs.categoryHints
      : [];

  return { categoryHints, requestId };
};

const persistAgentMarketplacePick = async (
  context: CustomInteractionContext | undefined,
  agentMarketplacePick: OnboardingAgentMarketplacePickSnapshot,
) => {
  if (!context?.topicId) return;

  try {
    await (context.updateTopicMetadata ?? topicService.updateTopicMetadata)(context.topicId, {
      onboardingSession: {
        agentMarketplacePick,
        lastActiveAt: agentMarketplacePick.resolvedAt,
      },
    });
  } catch (error) {
    console.error('[AgentMarketplace] failed to persist pick metadata', error);
  }
};

const handleAgentMarketplaceSubmit: CustomInteractionSubmitHandler = async (payload, context) => {
  const selectedAgentIds = payload.selectedTemplateIds;
  if (!isStringArray(selectedAgentIds)) return;

  const result = await installMarketplaceAgents(selectedAgentIds);
  const pickBase = resolveMarketplacePickBase(payload, context?.requestArgs);

  if (pickBase) {
    await persistAgentMarketplacePick(context, {
      ...pickBase,
      installedAgentIds: result.installedAgentIds,
      resolvedAt: new Date().toISOString(),
      selectedTemplateIds: selectedAgentIds,
      skippedAgentIds: result.skippedAgentIds,
      status: 'submitted',
    });
  }

  return {
    options: {
      createUserMessage: false,
      pluginState: {
        installedAgentIds: result.installedAgentIds,
        requestId: pickBase?.requestId,
        selectedAgentIds,
        skippedAgentIds: result.skippedAgentIds,
        summaries: result.summaries,
      },
      toolResultContent: buildAgentMarketplaceToolResult({
        installedAgentIds: result.installedAgentIds,
        selectedAgentIds,
        skippedAgentIds: result.skippedAgentIds,
        summaries: result.summaries,
      }),
    },
    payload: {
      ...payload,
      installedAgentIds: result.installedAgentIds,
      skippedAgentIds: result.skippedAgentIds,
    },
  };
};

const customInteractionSubmitHandlers = new Map<string, CustomInteractionSubmitHandler>([
  [AgentMarketplaceIdentifier, handleAgentMarketplaceSubmit],
]);

export const isCustomInteractionIdentifier = (identifier: string) =>
  identifier === UserInteractionIdentifier || customInteractionSubmitHandlers.has(identifier);

export const prepareCustomInteractionSubmit = async (
  identifier: string,
  payload: Record<string, unknown>,
  context?: CustomInteractionContext,
): Promise<CustomInteractionSubmitResult> => {
  const handler = customInteractionSubmitHandlers.get(identifier);
  const result = await handler?.(payload, context);

  return result ?? { payload };
};

export const recordCustomInteractionResolution = async (
  identifier: string,
  status: 'cancelled' | 'skipped',
  payload: Record<string, unknown> | undefined,
  context?: CustomInteractionContext,
  reason?: string,
) => {
  if (identifier !== AgentMarketplaceIdentifier) return;

  const pickBase = resolveMarketplacePickBase(payload ?? {}, context?.requestArgs);
  if (!pickBase) return;

  await persistAgentMarketplacePick(context, {
    ...pickBase,
    resolvedAt: new Date().toISOString(),
    ...(reason && { skipReason: reason }),
    status,
  });
};

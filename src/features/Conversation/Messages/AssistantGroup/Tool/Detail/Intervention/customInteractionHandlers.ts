import { ClaudeCodeIdentifier } from '@lobechat/builtin-tool-claude-code';
import { UserInteractionIdentifier } from '@lobechat/builtin-tool-user-interaction';
import {
  WebOnboardingApiName,
  WebOnboardingIdentifier,
} from '@lobechat/builtin-tool-web-onboarding';
import { buildAgentMarketplaceToolResult } from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
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
  apiName?: string;
  requestArgs?: Record<string, unknown>;
  topicId?: string | null;
  updateTopicMetadata?: typeof topicService.updateTopicMetadata;
}

type CustomInteractionSubmitHandler = (
  payload: Record<string, unknown>,
  context?: CustomInteractionContext,
) => Promise<CustomInteractionSubmitResult | undefined>;

const isAgentMarketplaceCall = (identifier: string, apiName?: string) =>
  identifier === WebOnboardingIdentifier && apiName === WebOnboardingApiName.showAgentMarketplace;

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

const customInteractionSubmitHandlers: Array<{
  handler: CustomInteractionSubmitHandler;
  match: (identifier: string, apiName?: string) => boolean;
}> = [
  {
    handler: handleAgentMarketplaceSubmit,
    match: isAgentMarketplaceCall,
  },
];

const findCustomInteractionSubmitHandler = (identifier: string, apiName?: string) =>
  customInteractionSubmitHandlers.find((entry) => entry.match(identifier, apiName))?.handler;

/**
 * Identifiers whose intervention component renders inline as a form (with
 * `onInteractionAction` callbacks) rather than the default approve / reject
 * approval UI. Hetero CLIs (CC AskUserQuestion etc.) need this surface
 * because the answer ships back through IPC, not through a synthetic user
 * turn.
 */
const HETERO_CUSTOM_INTERACTION_IDENTIFIERS = new Set<string>([ClaudeCodeIdentifier]);

export const isHeteroInteractionIdentifier = (identifier: string) =>
  HETERO_CUSTOM_INTERACTION_IDENTIFIERS.has(identifier);

export const isCustomInteractionIdentifier = (identifier: string, apiName?: string) =>
  identifier === UserInteractionIdentifier ||
  isHeteroInteractionIdentifier(identifier) ||
  Boolean(findCustomInteractionSubmitHandler(identifier, apiName));

export const prepareCustomInteractionSubmit = async (
  identifier: string,
  payload: Record<string, unknown>,
  context?: CustomInteractionContext,
): Promise<CustomInteractionSubmitResult> => {
  const handler = findCustomInteractionSubmitHandler(identifier, context?.apiName);
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
  if (!isAgentMarketplaceCall(identifier, context?.apiName)) return;

  const pickBase = resolveMarketplacePickBase(payload ?? {}, context?.requestArgs);
  if (!pickBase) return;

  await persistAgentMarketplacePick(context, {
    ...pickBase,
    resolvedAt: new Date().toISOString(),
    ...(reason && { skipReason: reason }),
    status,
  });
};

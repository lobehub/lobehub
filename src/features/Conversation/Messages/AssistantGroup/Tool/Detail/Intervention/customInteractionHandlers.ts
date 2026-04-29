import { AgentMarketplaceIdentifier } from '@lobechat/builtin-tool-agent-marketplace';
import { UserInteractionIdentifier } from '@lobechat/builtin-tool-user-interaction';
import type { OnboardingAgentMarketplacePickSnapshot } from '@lobechat/types';

import { topicService } from '@/services/topic';

import { installMarketplaceAgents } from './installMarketplaceAgents';

interface SubmitToolInteractionOptions {
  createUserMessage?: boolean;
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

const buildAgentMarketplaceToolResult = (params: {
  installedAgentIds: string[];
  selectedAgentIds: string[];
  skippedAgentIds: string[];
}) => {
  const { selectedAgentIds, installedAgentIds, skippedAgentIds } = params;
  const lines = [
    `User has finished picking from the marketplace. They selected ${selectedAgentIds.length} agent template(s); the agents are now forked into the user's library and ready to use. The user has already completed this step in the UI — do NOT thank them for opening the picker or claim you "opened the list" again.`,
    `selectedTemplateIds: ${JSON.stringify(selectedAgentIds)}`,
    `installedAgentIds: ${JSON.stringify(installedAgentIds)}`,
  ];
  if (skippedAgentIds.length > 0) {
    lines.push(
      `skippedAgentIds (already in library, not re-installed): ${JSON.stringify(skippedAgentIds)}`,
    );
  }
  lines.push(
    'THIS TURN — required actions to wrap up onboarding:',
    '1) Briefly acknowledge the picks in 1–2 sentences (no need to enumerate every template by name; reference the categories/themes you can infer).',
    '2) Call updateDocument(type="persona") to append a short note about the assistants the user picked (their categories/use cases) so future sessions remember.',
    '3) Call finishOnboarding to complete onboarding.',
    'Do NOT call showAgentMarketplace again. Do NOT ask the user to pick anything else.',
  );
  return lines.join('\n');
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
      toolResultContent: buildAgentMarketplaceToolResult({
        installedAgentIds: result.installedAgentIds,
        selectedAgentIds,
        skippedAgentIds: result.skippedAgentIds,
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

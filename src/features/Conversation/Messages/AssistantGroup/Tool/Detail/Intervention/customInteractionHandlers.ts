import { AgentMarketplaceIdentifier } from '@lobechat/builtin-tool-agent-marketplace';
import { UserInteractionIdentifier } from '@lobechat/builtin-tool-user-interaction';

import { installMarketplaceAgents } from './installMarketplaceAgents';

interface SubmitToolInteractionOptions {
  createUserMessage?: boolean;
}

interface CustomInteractionSubmitResult {
  options?: SubmitToolInteractionOptions;
  payload: Record<string, unknown>;
}

type CustomInteractionSubmitHandler = (
  payload: Record<string, unknown>,
) => Promise<CustomInteractionSubmitResult | undefined>;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const handleAgentMarketplaceSubmit: CustomInteractionSubmitHandler = async (payload) => {
  const selectedAgentIds = payload.selectedTemplateIds;
  if (!isStringArray(selectedAgentIds)) return;

  const result = await installMarketplaceAgents(selectedAgentIds);

  return {
    options: { createUserMessage: false },
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
): Promise<CustomInteractionSubmitResult> => {
  const handler = customInteractionSubmitHandlers.get(identifier);
  const result = await handler?.(payload);

  return result ?? { payload };
};

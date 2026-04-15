import type {
  AgentFailoverCapability,
  ChatCompletionTool,
  LobeAgentChatConfig,
  UIChatMessage,
  WorkingModel,
} from '@lobechat/types';

export interface AgentModelCandidate extends WorkingModel {
  index: number;
  source: 'failover' | 'primary';
}

const dedupeCandidates = (models: WorkingModel[]): AgentModelCandidate[] => {
  const seen = new Set<string>();

  return models.reduce<AgentModelCandidate[]>((acc, item, index) => {
    if (!item?.model || !item?.provider) return acc;

    const key = `${item.provider}/${item.model}`;
    if (seen.has(key)) return acc;

    seen.add(key);
    acc.push({
      index: acc.length,
      model: item.model,
      provider: item.provider,
      source: index === 0 ? 'primary' : 'failover',
    });

    return acc;
  }, []);
};

export const buildAgentModelCandidates = ({
  failoverModels,
  primary,
}: {
  failoverModels?: WorkingModel[];
  primary: WorkingModel;
}): AgentModelCandidate[] => dedupeCandidates([primary, ...(failoverModels || [])]);

export const detectRequiredCapabilities = ({
  messages,
  tools,
}: {
  messages: UIChatMessage[];
  tools?: ChatCompletionTool[];
}): AgentFailoverCapability[] => {
  const capabilities = new Set<AgentFailoverCapability>();

  if (tools && tools.length > 0) capabilities.add('functionCall');

  for (const message of messages) {
    if (message.imageList && message.imageList.length > 0) capabilities.add('vision');
    if (message.videoList && message.videoList.length > 0) capabilities.add('video');
  }

  return [...capabilities];
};

export const selectAgentModelCandidates = ({
  failoverModels,
  messages,
  primary,
  supportsCapability,
  tools,
}: {
  failoverModels?: LobeAgentChatConfig['failoverModels'];
  messages: UIChatMessage[];
  primary: WorkingModel;
  supportsCapability: (
    model: string,
    provider: string,
    capability: AgentFailoverCapability,
  ) => boolean;
  tools?: ChatCompletionTool[];
}) => {
  const requiredCapabilities = detectRequiredCapabilities({ messages, tools });
  const candidates = buildAgentModelCandidates({ failoverModels, primary });

  if (requiredCapabilities.length === 0) {
    return { candidates, requiredCapabilities };
  }

  const matchingCandidates = candidates.filter((candidate) =>
    requiredCapabilities.every((capability) =>
      supportsCapability(candidate.model, candidate.provider, capability),
    ),
  );

  return {
    candidates: matchingCandidates.length > 0 ? matchingCandidates : candidates,
    requiredCapabilities,
  };
};

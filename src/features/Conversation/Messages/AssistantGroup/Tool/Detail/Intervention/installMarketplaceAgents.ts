import { customAlphabet } from 'nanoid/non-secure';

import { agentService } from '@/services/agent';
import { discoverService } from '@/services/discover';
import { marketApiService } from '@/services/marketApi';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';

const generateMarketIdentifier = () => {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const generate = customAlphabet(alphabet, 8);
  return generate();
};

const getSourcePath = () => {
  if (typeof location === 'undefined') return 'onboarding/agent-marketplace';

  return location.pathname;
};

export interface InstallMarketplaceAgentsResult {
  installedAgentIds: string[];
  skippedAgentIds: string[];
}

export const installMarketplaceAgents = async (
  sourceAgentIds: string[],
): Promise<InstallMarketplaceAgentsResult> => {
  const installedAgentIds: string[] = [];
  const skippedAgentIds: string[] = [];
  const createAgent = useAgentStore.getState().createAgent;
  const refreshAgentList = useHomeStore.getState().refreshAgentList;

  for (const sourceAgentId of sourceAgentIds) {
    const existingAgentId = await agentService.getAgentByForkedFromIdentifier(sourceAgentId);
    if (existingAgentId) {
      skippedAgentIds.push(sourceAgentId);
      continue;
    }

    const marketAgent = await discoverService.getAssistantDetail({
      identifier: sourceAgentId,
      source: 'new',
    });

    if (!marketAgent?.config) {
      throw new Error(`Marketplace agent config is missing: ${sourceAgentId}`);
    }

    const forkResult = await marketApiService.forkAgent(sourceAgentId, {
      identifier: generateMarketIdentifier(),
      name: marketAgent.title,
      status: 'published',
      visibility: 'public',
    });

    const result = await createAgent({
      config: {
        ...marketAgent.config,
        avatar: marketAgent.avatar,
        backgroundColor: marketAgent.backgroundColor,
        description: marketAgent.description,
        editorData: marketAgent.editorData,
        marketIdentifier: forkResult.agent.identifier,
        params: {
          ...marketAgent.config.params,
          forkedFromIdentifier: sourceAgentId,
        },
        tags: marketAgent.tags,
        title: forkResult.agent.name,
      },
    });

    installedAgentIds.push(result.agentId);

    discoverService.reportAgentEvent({
      event: 'add',
      identifier: forkResult.agent.identifier,
      source: getSourcePath(),
    });
  }

  if (installedAgentIds.length > 0) {
    await refreshAgentList();
  }

  return { installedAgentIds, skippedAgentIds };
};

import type { InstallMarketplaceAgentSummary } from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
import { customAlphabet } from 'nanoid/non-secure';

import { agentService } from '@/services/agent';
import { discoverService } from '@/services/discover';
import { marketApiService } from '@/services/marketApi';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';

export type { InstallMarketplaceAgentSummary };

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
  summaries: InstallMarketplaceAgentSummary[];
}

export const installMarketplaceAgents = async (
  sourceAgentIds: string[],
): Promise<InstallMarketplaceAgentsResult> => {
  if (sourceAgentIds.length === 0) {
    return { installedAgentIds: [], skippedAgentIds: [], summaries: [] };
  }

  const createAgent = useAgentStore.getState().createAgent;
  const refreshAgentList = useHomeStore.getState().refreshAgentList;

  // 1. Parallel dedupe — find which source ids are already forked
  const existing = await Promise.all(
    sourceAgentIds.map((id) => agentService.getAgentByForkedFromIdentifier(id)),
  );
  const skippedAgentIds: string[] = [];
  const pendingSourceIds: string[] = [];
  sourceAgentIds.forEach((id, i) => {
    if (existing[i]) skippedAgentIds.push(id);
    else pendingSourceIds.push(id);
  });

  // 2. Parallel fetch market detail for pending ids (best-effort per item)
  const detailResults = await Promise.allSettled(
    pendingSourceIds.map((id) =>
      discoverService.getAssistantDetail({ identifier: id, source: 'new' }),
    ),
  );

  // 3. Build batch fork input only for items with valid detail
  type Prepared = {
    detail: NonNullable<Awaited<ReturnType<typeof discoverService.getAssistantDetail>>>;
    newIdentifier: string;
    sourceId: string;
  };
  const prepared: Prepared[] = [];
  detailResults.forEach((result, i) => {
    const sourceId = pendingSourceIds[i];
    if (result.status !== 'fulfilled') {
      console.warn('Failed to fetch marketplace agent detail:', sourceId, result.reason);
      return;
    }
    const detail = result.value;
    if (!detail?.config) {
      console.warn('Marketplace agent config is missing:', sourceId);
      return;
    }
    prepared.push({
      detail: detail as Prepared['detail'],
      newIdentifier: generateMarketIdentifier(),
      sourceId,
    });
  });

  // 4. Single batch fork call
  const forkOutcomes =
    prepared.length === 0
      ? []
      : await marketApiService.forkAgent(
          prepared.map((p) => ({
            identifier: p.newIdentifier,
            name: p.detail.title,
            sourceIdentifier: p.sourceId,
            status: 'published',
            visibility: 'public',
          })),
        );

  // 5. Parallel local createAgent for successful forks
  const installResults = await Promise.allSettled(
    forkOutcomes.map(async (outcome, i) => {
      const { detail, sourceId } = prepared[i];
      if (!outcome.success) {
        throw new Error(outcome.error.message);
      }
      const fork = outcome.data;
      const result = await createAgent({
        config: {
          ...detail.config,
          avatar: detail.avatar,
          backgroundColor: detail.backgroundColor,
          description: detail.description,
          editorData: detail.editorData,
          marketIdentifier: fork.agent.identifier,
          params: {
            ...detail.config.params,
            forkedFromIdentifier: sourceId,
          },
          tags: detail.tags,
          title: fork.agent.name,
        },
      });

      discoverService.reportAgentEvent({
        event: 'add',
        identifier: fork.agent.identifier,
        source: getSourcePath(),
      });

      return { agentId: result.agentId, sourceId };
    }),
  );

  // 6. Build summaries — preserve the original per-source ordering
  const installedBySource = new Map<string, string>();
  installResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      installedBySource.set(r.value.sourceId, r.value.agentId);
    } else {
      console.warn('Failed to install marketplace agent:', prepared[i]?.sourceId, r.reason);
    }
  });

  const detailBySource = new Map<string, Prepared['detail']>();
  prepared.forEach((p) => detailBySource.set(p.sourceId, p.detail));

  const summaries: InstallMarketplaceAgentSummary[] = sourceAgentIds.map((sourceId) => {
    if (skippedAgentIds.includes(sourceId)) {
      return { skipped: true, templateId: sourceId };
    }
    const detail = detailBySource.get(sourceId);
    return {
      avatar: detail?.avatar,
      category: detail?.category,
      description: detail?.description || detail?.summary,
      installedAgentId: installedBySource.get(sourceId),
      skipped: false,
      templateId: sourceId,
      title: detail?.title,
    };
  });

  const installedAgentIds = Array.from(installedBySource.values());

  if (installedAgentIds.length > 0) {
    await refreshAgentList();
  }

  return { installedAgentIds, skippedAgentIds, summaries };
};

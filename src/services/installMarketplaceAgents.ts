import type { InstallMarketplaceAgentSummary } from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
import { customAlphabet } from 'nanoid/non-secure';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { lambdaClient } from '@/libs/trpc/client';
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
  /**
   * True only when this call freshly auto-provisioned the workspace's Market
   * Community profile (owner-only path). Lets the caller surface a "we set up
   * a community handle for you — customize it later" nudge once, instead of
   * silently mutating the workspace's public identity.
   */
  createdMarketProfile?: boolean;
  installedAgentIds: string[];
  skippedAgentIds: string[];
  summaries: InstallMarketplaceAgentSummary[];
}

export interface InstallMarketplaceAgentsOptions {
  /**
   * Override the visibility used when inserting into a workspace. Defaults to
   * `'public'` (shared with the workspace) — callers can opt into `'private'`
   * when the user explicitly wants the agent kept to themselves.
   *
   * Ignored in personal mode (the column is meaningless without a workspace).
   */
  visibility?: 'private' | 'public';
}

export const installMarketplaceAgents = async (
  sourceAgentIds: string[],
  options?: InstallMarketplaceAgentsOptions,
): Promise<InstallMarketplaceAgentsResult> => {
  if (sourceAgentIds.length === 0) {
    return { installedAgentIds: [], skippedAgentIds: [], summaries: [] };
  }

  const createAgent = useAgentStore.getState().createAgent;
  const refreshAgentList = useHomeStore.getState().refreshAgentList;

  const workspaceId = getActiveWorkspaceId();
  const visibility = workspaceId ? (options?.visibility ?? 'public') : undefined;

  // Workspace-mode forks must be attributed to the workspace's Market org via
  // `actAs` — the per-user trust token already carries workspaceId, so Market
  // rejects forks without `x-lobe-owner-account-id` (403). Mirrors the lookup
  // ForkAndChat does for the single-fork community flow.
  //
  // `autoProvision` lets owners install agents on a brand-new workspace before
  // they've explicitly set a Community handle — server derives one from the
  // workspace name. Non-owners fall through to the strict path and get
  // PRECONDITION_FAILED, which the caller (e.g. onboarding) surfaces as a
  // soft toast.
  let actAs: number | undefined;
  let createdMarketProfile = false;
  if (workspaceId) {
    const { marketAccountId, created } =
      await lambdaClient.workspace.ensureMarketOrganization.mutate({
        autoProvision: true,
      });
    actAs = marketAccountId;
    createdMarketProfile = created;
  }

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
            actAs,
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
        visibility,
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

  return { createdMarketProfile, installedAgentIds, skippedAgentIds, summaries };
};

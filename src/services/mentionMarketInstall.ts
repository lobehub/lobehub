import type { DiscoverAssistantDetail } from '@lobechat/types';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import type {
  MarketInstallVisibility,
  PendingMarketAgent,
  PendingMarketSkill,
} from '@/features/ChatInput/InputEditor/marketMention';
import { agentService } from '@/services/agent';
import { discoverService } from '@/services/discover';
import {
  ensureAgentMarketSkills,
  ensureAgentMarketSkillsAndWarn,
} from '@/services/ensureAgentMarketSkills';
import { buildMarketAgentConfig } from '@/services/installMarketplaceAgents';
import type { EnsureMarketSkillResult } from '@/services/skill';
import { useAgentStore } from '@/store/agent';

/**
 * Readies the Market agents and skills picked from the composer's @ menu.
 *
 * Speed matters here because the send waits for it: an agent is readied the
 * moment its chip is picked, and the agent's own Market skills are installed
 * alongside its local row instead of after it.
 */

/**
 * Share work that is still in flight, so the send reuses what picking the chip
 * started. Settled work is not kept: each later attempt checks again (cheaply —
 * an installed skill or an existing hidden copy is found without reinstalling),
 * so a failure is retried and a skill removed since is installed again.
 */
const shareInFlight = <T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>) => {
  const pending = cache.get(key);
  if (pending) return pending;

  const promise = load().finally(() => cache.delete(key));
  cache.set(key, promise);
  return promise;
};

const detailCache = new Map<string, Promise<DiscoverAssistantDetail>>();
const installCache = new Map<string, Promise<string>>();
const skillCache = new Map<string, Promise<void>>();

const loadAgentDetail = (identifier: string) =>
  shareInFlight(detailCache, identifier, async () => {
    const detail = await discoverService.getAssistantDetail({ identifier });
    if (!detail?.config) throw new Error(`Market agent ${identifier} is unavailable`);
    return detail as DiscoverAssistantDetail;
  });

/**
 * Mentioning a Market agent runs it without installing it: the run needs a
 * local agent row (its prompt, model and tools), so the agent gets a hidden
 * (`virtual`) copy — kept out of the agent list and not forked to the Market —
 * that later mentions reuse. Installing it stays an explicit Market action.
 */
const prepareMarketAgent = (identifier: string, visibility: MarketInstallVisibility) => {
  const workspaceId = getActiveWorkspaceId();
  const key = `${workspaceId ?? ''}:${visibility}:${identifier}`;

  return shareInFlight(installCache, key, async () => {
    const existing = await agentService.getAgentByForkedFromIdentifier(identifier, {
      virtual: true,
    });
    if (existing) {
      // A Market skill it depends on may have failed to install when the copy was
      // made; installed ones are skipped locally, so this only retries what's missing.
      const config = await agentService.getAgentConfigById(existing);
      await ensureAgentMarketSkillsAndWarn(config?.plugins);
      return existing;
    }

    const detail = await loadAgentDetail(identifier);
    const [result] = await Promise.all([
      useAgentStore.getState().createAgent({
        // Nobody adopts a hidden copy, so it keeps the Market name instead of
        // drawing a personal one: the reply is labelled — and the agent
        // introduces itself — as the expert the user picked.
        config: {
          ...buildMarketAgentConfig(detail, identifier),
          name: detail.title,
          virtual: true,
        },
        ...(workspaceId ? { visibility } : {}),
      }),
      ensureAgentMarketSkillsAndWarn(detail.config.plugins),
    ]);

    return result.agentId;
  });
};

/**
 * Start readying a Market agent the moment its chip is picked, while the user is
 * still typing: an agent with large Market skills can take many seconds to set up,
 * and the send then only awaits whatever is left. A failure is not shared, so the
 * send retries it and reports it.
 */
export const prepareMentionedMarketAgent = (
  identifier: string,
  visibility: MarketInstallVisibility,
) => {
  prepareMarketAgent(identifier, visibility).catch((error) => {
    console.error('[mention] failed to prepare market agent early', identifier, error);
  });
};

class MarketSkillPrepareError extends Error {
  constructor(readonly result: EnsureMarketSkillResult) {
    super(`Failed to install skill: ${result.identifier}`);
    this.name = 'MarketSkillPrepareError';
  }
}

/** Install a Market skill picked from the @ menu unless it is already installed. */
const prepareMarketSkill = (identifier: string) =>
  shareInFlight(skillCache, `${getActiveWorkspaceId() ?? ''}:${identifier}`, async () => {
    const [result] = await ensureAgentMarketSkills([identifier]);
    if (result?.status === 'failed' || result?.status === 'notSkill') {
      throw new MarketSkillPrepareError(result);
    }
  });

/** Start installing a Market skill the moment its chip is picked, like Market agents. */
export const prepareMentionedMarketSkill = (identifier: string) => {
  prepareMarketSkill(identifier).catch((error) => {
    console.error('[mention] failed to prepare market skill early', identifier, error);
  });
};

export class MarketMentionInstallError extends Error {
  constructor(readonly failedNames: string[]) {
    super(`Failed to install: ${failedNames.join(', ')}`);
    this.name = 'MarketMentionInstallError';
  }
}

export interface MarketMentionInstallRequest {
  agents: PendingMarketAgent[];
  skills: PendingMarketSkill[];
}

/**
 * Install everything the message references from the Market, in parallel.
 * Resolves the installed agent id of each Market agent identifier; throws
 * `MarketMentionInstallError` naming whatever could not be installed.
 */
export const installMarketMentions = async ({
  agents,
  skills,
}: MarketMentionInstallRequest): Promise<Map<string, string>> => {
  const [agentResults, skillResults] = await Promise.all([
    Promise.allSettled(
      agents.map((agent) => prepareMarketAgent(agent.identifier, agent.visibility)),
    ),
    Promise.allSettled(skills.map((skill) => prepareMarketSkill(skill.identifier))),
  ]);

  const installed = new Map<string, string>();
  const failedNames: string[] = [];

  agentResults.forEach((result, index) => {
    const agent = agents[index];
    if (result.status === 'fulfilled') installed.set(agent.identifier, result.value);
    else {
      console.error('[mention] failed to install market agent', agent.identifier, result.reason);
      failedNames.push(agent.label);
    }
  });
  skillResults.forEach((result, index) => {
    if (result.status === 'fulfilled') return;
    console.error(
      '[mention] failed to install market skill',
      skills[index].identifier,
      result.reason,
    );
    failedNames.push(skills[index].label);
  });

  if (failedNames.length > 0) throw new MarketMentionInstallError(failedNames);
  return installed;
};

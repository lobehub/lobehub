import type { ISlashMenuOption } from '@lobehub/editor';
import { Avatar, cssVar, Flexbox } from '@lobehub/ui';
import type { ReactNode } from 'react';

import { discoverService } from '@/services/discover';
import { globalHelpers } from '@/store/global/helpers';
import type { DiscoverAssistantItem, DiscoverSkillItem } from '@/types/discover';

import { marketAgentMentionId, type MarketInstallVisibility } from './marketMention';
import MentionItemIcon from './MentionItemIcon';

/** Market rows fetched per list; installed ones are filtered out of it, so ask for more than shown. */
export const MARKET_MENTION_FETCH_SIZE = 12;
const SEARCH_TIMEOUT_MS = 1500;
const SEARCH_CACHE_SIZE = 50;

export const mentionLabel = (title: string, secondary?: string): ReactNode =>
  secondary ? (
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0, overflow: 'hidden' }}>
      <span style={{ flex: 'none' }}>{title}</span>
      <span
        style={{
          color: cssVar.colorTextDescription,
          fontSize: 12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {secondary}
      </span>
    </Flexbox>
  ) : (
    title
  );

export const toMarketAgentItem = (
  agent: DiscoverAssistantItem,
  visibility: MarketInstallVisibility,
): ISlashMenuOption => {
  const title = agent.title?.trim() || agent.identifier;
  const description = agent.description?.trim();

  return {
    icon: (
      <Avatar
        avatar={typeof agent.avatar === 'string' ? agent.avatar : undefined}
        background={agent.backgroundColor ?? undefined}
        size={24}
      />
    ),
    key: `market-agent-${agent.identifier}`,
    label: mentionLabel(title, description),
    metadata: {
      id: marketAgentMentionId(agent.identifier),
      label: title,
      marketIdentifier: agent.identifier,
      marketVisibility: visibility,
      searchText: [title, description, ...(agent.tags ?? [])].filter(Boolean).join(' '),
      timestamp: 0,
      type: 'agent' as const,
    },
  };
};

export const toMarketSkillItem = (skill: DiscoverSkillItem): ISlashMenuOption => {
  const label = skill.name?.trim() || skill.identifier;

  return {
    icon: <MentionItemIcon avatar={skill.icon} category={'skill'} label={label} />,
    key: `market-skill-${skill.identifier}`,
    label,
    metadata: {
      actionCategory: 'skill',
      actionType: skill.identifier,
      description: skill.description,
      // Installed the moment it is picked, so the send does not wait for it.
      marketSkill: true,
      searchText: [label, skill.description].filter(Boolean).join(' '),
      timestamp: 0,
      type: 'skill' as const,
    },
  };
};

export interface MarketSearchResult {
  agents: DiscoverAssistantItem[];
  skills: DiscoverSkillItem[];
}

const searchCache = new Map<string, Promise<MarketSearchResult>>();

const searchMarket = (
  query: string,
  { agents, skills }: { agents: boolean; skills: boolean },
): Promise<MarketSearchResult> => {
  const key = `${globalHelpers.getCurrentLanguage()}:${agents}:${skills}:${query}`;
  const cached = searchCache.get(key);
  if (cached) return cached;

  const request = Promise.all([
    agents
      ? discoverService
          .getAssistantList({ page: 1, pageSize: MARKET_MENTION_FETCH_SIZE, q: query })
          .then((result) => result.items)
      : [],
    skills
      ? discoverService
          .getSkillList({ page: 1, pageSize: MARKET_MENTION_FETCH_SIZE, q: query })
          .then((result) => result.items)
      : [],
  ]).then(([agentItems, skillItems]) => ({ agents: agentItems, skills: skillItems }));

  searchCache.set(key, request);
  request.catch(() => searchCache.delete(key));
  if (searchCache.size > SEARCH_CACHE_SIZE) {
    searchCache.delete(searchCache.keys().next().value!);
  }
  return request;
};

const EMPTY_RESULT: MarketSearchResult = { agents: [], skills: [] };

/**
 * Market search for the @ menu. Never rejects and never holds the menu longer
 * than the timeout: a slow answer is still cached, so the next keystroke shows it.
 */
export const searchMarketForMention = (
  query: string,
  scope: { agents: boolean; skills: boolean },
): Promise<MarketSearchResult> => {
  if (!query.trim() || (!scope.agents && !scope.skills)) return Promise.resolve(EMPTY_RESULT);

  return Promise.race([
    searchMarket(query.trim(), scope).catch((error) => {
      console.warn('[mention] market search failed:', error);
      return EMPTY_RESULT;
    }),
    new Promise<MarketSearchResult>((resolve) =>
      setTimeout(() => resolve(EMPTY_RESULT), SEARCH_TIMEOUT_MS),
    ),
  ]);
};

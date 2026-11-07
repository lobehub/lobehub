import { agentDisplayName } from '@lobechat/types';
import { Avatar, Icon } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import isEqual from 'fast-deep-equal';
import { Bot, Lock, MessageSquareText, Users, Wrench } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SidebarAgentItem } from '@/database/repositories/home';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useDiscoverStore } from '@/store/discover';
import { assistantSelectors, skillSelectors } from '@/store/discover/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useToolStore } from '@/store/tool';
import { AssistantSorts, SkillSorts } from '@/types/discover';

import { useAgentId } from '../hooks/useAgentId';
import { useChatInputStore } from '../store';
import { useInstalledSkillsAndTools } from './ActionTag/useInstalledSkillsAndTools';
import type { MarketInstallVisibility } from './marketMention';
import {
  MARKET_MENTION_FETCH_SIZE,
  mentionLabel,
  toMarketAgentItem,
  toMarketSkillItem,
} from './marketMentionItems';
import MentionItemIcon from './MentionItemIcon';
import type { MentionCategory } from './MentionMenu/types';
import { AGENT_CATEGORY_IDS, mergeIntoCategory, SKILL_PRECEDING_IDS } from './mentionMenuSections';

const MAX_AGENT_ITEMS = 20;
const MAX_TOPIC_LABEL = 50;
type MenuOptionWithMetadata = { key: string; metadata?: Record<string, unknown> };

/** What the menu needs to turn a Market search into installable entries. */
export interface MarketMentionScope {
  /** Section uninstalled agents join (where they land once installed); absent in group chats. */
  agentCategory?: Omit<MentionCategory, 'items'>;
  agents: boolean;
  agentVisibility: MarketInstallVisibility;
  /** Market identifiers the caller already has as a mentionable agent here. */
  installedAgentSources: ReadonlySet<string>;
  installedSkills: ReadonlySet<string>;
  /** Section uninstalled skills join. */
  skillCategory: Omit<MentionCategory, 'items'>;
  skills: boolean;
}

export interface MentionSource {
  categories: MentionCategory[];
  market: MarketMentionScope;
}

export const useMentionCategories = (): MentionSource => {
  const { t } = useTranslation('chat');
  const currentAgentId = useAgentId();
  const pinnedAgents = useHomeStore(homeAgentListSelectors.pinnedAgents, isEqual);
  const workspaceGroups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
  const workspaceUngrouped = useHomeStore(homeAgentListSelectors.ungroupedAgents, isEqual);
  const privateGroups = useHomeStore(homeAgentListSelectors.privateAgentGroups, isEqual);
  const privatePinned = useHomeStore(homeAgentListSelectors.privatePinnedAgents, isEqual);
  const privateUngrouped = useHomeStore(homeAgentListSelectors.privateUngroupedAgents, isEqual);

  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);
  const topicsSelector = useMemo(
    () => topicSelectors.displayTopicsForSidebar(topicPageSize),
    [topicPageSize],
  );
  const topics = useChatStore(topicsSelector);
  const activeTopicId = useChatStore((s) => s.activeTopicId);

  const externalMentionItems = useChatInputStore((s) => s.mentionItems);
  const isGroupChat = !!externalMentionItems;

  // The installed-skill list is otherwise only fetched by skill settings pages;
  // without it here, a Market skill installed from this menu (or anywhere
  // else) would keep being offered as not installed after a reload.
  const useFetchAgentSkills = useToolStore((s) => s.useFetchAgentSkills);
  useFetchAgentSkills(true);
  const enabledSkills = useInstalledSkillsAndTools();

  // Market entries install on send, which creates content in the active scope.
  const { allowed: canInstall } = usePermission('create_content');
  const useAssistantList = useDiscoverStore((s) => s.useFetchAssistantList);
  const useSkillList = useDiscoverStore((s) => s.useFetchSkillList);
  const marketAgentsEnabled = canInstall && !isGroupChat;
  const { queryKey: marketAgentKey } = useAssistantList(
    { page: 1, pageSize: MARKET_MENTION_FETCH_SIZE, sort: AssistantSorts.Recommended },
    { enabled: marketAgentsEnabled },
  );
  const { queryKey: marketSkillKey } = useSkillList(
    { page: 1, pageSize: MARKET_MENTION_FETCH_SIZE, sort: SkillSorts.InstallCount },
    { enabled: canInstall },
  );
  const marketAgents = useDiscoverStore(assistantSelectors.assistantList(marketAgentKey))?.items;
  const marketSkills = useDiscoverStore(skillSelectors.skillList(marketSkillKey))?.items;

  return useMemo(() => {
    let categories: MentionCategory[] = [];
    let agentCategory: Omit<MentionCategory, 'items'> | undefined;
    const installedAgentSources = new Set<string>();
    let agentVisibility: MarketInstallVisibility = 'public';

    const toItem = (agent: SidebarAgentItem) => {
      const name = agent.name?.trim();
      const title = agent.title?.trim();
      const description = agent.description?.trim();
      const displayName = agentDisplayName(agent, 'Untitled Agent');
      // The headline slot holds the personal name; the role only moves to the
      // secondary slot when a name occupies the headline — otherwise the role IS
      // the headline and repeating it would read "架构工程师 · 架构工程师".
      const secondary = [name ? title : undefined, description].filter(Boolean).join(' · ');

      return {
        icon: (
          <Avatar
            avatar={typeof agent.avatar === 'string' ? agent.avatar : undefined}
            background={agent.backgroundColor ?? undefined}
            size={24}
          />
        ),
        key: `agent-${agent.id}`,
        label: mentionLabel(displayName, secondary),
        metadata: {
          id: agent.id,
          // The rendered label is a ReactNode; keep the plain-text identity here
          // for the inserted chip (`mentionOnSelect`) and for Fuse search.
          label: displayName,
          searchText: [name, title, description].filter(Boolean).join(' '),
          timestamp: agent.updatedAt ? new Date(agent.updatedAt).getTime() : 0,
          type: 'agent' as const,
        },
      };
    };

    const dedupeAgents = (list: SidebarAgentItem[]): SidebarAgentItem[] => {
      const seen = new Set<string>();
      const out: SidebarAgentItem[] = [];
      for (const a of list) {
        if (a.type !== 'agent') continue;
        if (a.id === currentAgentId || seen.has(a.id)) continue;
        seen.add(a.id);
        out.push(a);
      }
      return out;
    };

    // --- Agents (non-group only). Split private vs workspace so the picker
    // mirrors the sidebar's bucketing instead of mixing other members'
    // workspace agents with the caller's own private ones. ---
    if (!isGroupChat) {
      // Compute the caller-owned private id set from the raw home-store
      // selectors BEFORE dedupe: dedupeAgents drops `currentAgentId` from the
      // candidate lists (so the picker never suggests self-mention), but the
      // gate needs to see the current agent to recognize it as private. Using
      // the dedupe result would make `isCurrentContextPrivate` always false
      // even inside the caller's own private agent — the bug this fixes.
      const privateAgentIds = new Set<string>();
      for (const g of privateGroups) for (const a of g.items) privateAgentIds.add(a.id);
      for (const a of privatePinned) privateAgentIds.add(a.id);
      for (const a of privateUngrouped) privateAgentIds.add(a.id);

      const workspaceCandidates = dedupeAgents([
        ...pinnedAgents,
        ...workspaceGroups.flatMap((g) => g.items),
        ...workspaceUngrouped,
      ]);
      const privateCandidates = dedupeAgents([
        ...privatePinned,
        ...privateGroups.flatMap((g) => g.items),
        ...privateUngrouped,
      ]);

      // Ownership-and-visibility gate for the private bucket. Once a mention
      // fires it becomes a `callAgent` tool-call in the current topic, and
      // topic/message rows are workspace-scoped without visibility — so the
      // sub-agent's assistant output would land in a topic that every
      // workspace member can read. Only expose private agents when the parent
      // context is itself a caller-owned private agent; then the topic is
      // effectively invisible to the rest of the workspace and the private
      // invariant holds.
      const isCurrentContextPrivate = !!currentAgentId && privateAgentIds.has(currentAgentId);
      // A Market agent installed from here lands where it can be mentioned
      // again: private beside a private agent, shared otherwise.
      agentVisibility = isCurrentContextPrivate ? 'private' : 'public';

      // Market agents already installed and mentionable here (or the current
      // agent itself) are not offered again from the Market.
      const mentionableHere = [
        ...pinnedAgents,
        ...workspaceGroups.flatMap((g) => g.items),
        ...workspaceUngrouped,
        ...(isCurrentContextPrivate
          ? [...privatePinned, ...privateGroups.flatMap((g) => g.items), ...privateUngrouped]
          : []),
      ];
      for (const agent of mentionableHere) {
        if (agent.forkedFromIdentifier) installedAgentSources.add(agent.forkedFromIdentifier);
      }
      const currentAgent = [
        ...mentionableHere,
        ...privatePinned,
        ...privateGroups.flatMap((g) => g.items),
        ...privateUngrouped,
      ].find((agent) => agent.id === currentAgentId);
      if (currentAgent?.forkedFromIdentifier) {
        installedAgentSources.add(currentAgent.forkedFromIdentifier);
      }

      // Quota stays at MAX_AGENT_ITEMS total. When the user has private agents
      // we reserve up to half for them so they don't get drowned out by a long
      // workspace list.
      const privateBudget = isCurrentContextPrivate ? Math.min(privateCandidates.length, 10) : 0;
      const workspaceBudget = MAX_AGENT_ITEMS - privateBudget;
      const privateItems = privateCandidates.slice(0, privateBudget).map(toItem);
      const workspaceItems = workspaceCandidates.slice(0, workspaceBudget).map(toItem);

      if (privateItems.length > 0) {
        categories.push({
          id: 'agent-private',
          icon: <Icon icon={Lock} size={16} />,
          items: privateItems,
          label: t('mention.category.privateAgents'),
        });
      }

      if (workspaceItems.length > 0) {
        // Keep the legacy `id: 'agent'` so downstream consumers that key off the
        // category id (e.g. analytics, selection routing) keep working when the
        // user has no private agents.
        const id = privateItems.length > 0 ? 'agent-workspace' : 'agent';
        const label =
          privateItems.length > 0
            ? t('mention.category.workspaceAgents')
            : t('mention.category.agents');
        categories.push({
          id,
          icon: <Icon icon={Bot} size={16} />,
          items: workspaceItems,
          label,
        });
      }

      // Uninstalled entries sit in the same section as installed ones — where
      // they will land once installed on send — so the user never sees a
      // difference between the two.
      agentCategory = isCurrentContextPrivate
        ? {
            icon: <Icon icon={Lock} size={16} />,
            id: 'agent-private',
            label: t('mention.category.privateAgents'),
          }
        : {
            icon: <Icon icon={Bot} size={16} />,
            id: privateItems.length > 0 ? 'agent-workspace' : 'agent',
            label:
              privateItems.length > 0
                ? t('mention.category.workspaceAgents')
                : t('mention.category.agents'),
          };
      if (marketAgentsEnabled) {
        categories = mergeIntoCategory(
          categories,
          {
            ...agentCategory,
            items: (marketAgents ?? [])
              .filter((agent) => !installedAgentSources.has(agent.identifier))
              .map((agent) => toMarketAgentItem(agent, agentVisibility)),
          },
          AGENT_CATEGORY_IDS,
        );
      }
    }

    // --- Members (group chat only) ---
    if (isGroupChat && Array.isArray(externalMentionItems)) {
      const items = externalMentionItems
        .filter((item): item is MenuOptionWithMetadata => 'key' in item && !!item.key)
        .map((item) => ({
          ...item,
          metadata: Object.assign({ timestamp: 0, type: 'member' as const }, item.metadata),
        }));

      if (items.length > 0) {
        categories.push({
          id: 'member',
          icon: <Icon icon={Users} size={16} />,
          items,
          label: t('mention.category.members'),
        });
      }
    }

    // --- Topics ---
    if (topics && topics.length > 0) {
      const items = topics
        .filter((t) => t.id !== activeTopicId)
        .map((topic) => {
          const title = topic.title || t('topic.defaultTitle');
          const label =
            title.length > MAX_TOPIC_LABEL ? `${title.slice(0, MAX_TOPIC_LABEL)}...` : title;
          return {
            icon: <Icon icon={MessageSquareText} size={16} />,
            key: `topic-${topic.id}`,
            label,
            metadata: {
              topicId: topic.id,
              topicTitle: topic.title,
              timestamp: topic.updatedAt || 0,
              type: 'topic' as const,
            },
          };
        });

      if (items.length > 0) {
        categories.push({
          id: 'topic',
          icon: <Icon icon={MessageSquareText} size={16} />,
          items,
          label: t('mention.category.topics'),
        });
      }
    }

    // --- Skills ---
    const skillItems = enabledSkills.filter((s) => s.category === 'skill');
    if (skillItems.length > 0) {
      categories.push({
        id: 'skill',
        icon: <Icon icon={SkillsIcon} size={16} />,
        items: skillItems.map((item) => ({
          icon: <MentionItemIcon avatar={item.icon} category={'skill'} label={item.label} />,
          key: `skill-${item.type}`,
          label: item.label,
          metadata: {
            actionCategory: item.category,
            actionType: item.type,
            description: item.description,
            timestamp: 0,
            type: 'skill' as const,
          },
        })),
        label: t('mention.category.skills'),
      });
    }

    const installedSkills = new Set(skillItems.map((item) => item.type));
    const skillCategory: Omit<MentionCategory, 'items'> = {
      icon: <Icon icon={SkillsIcon} size={16} />,
      id: 'skill',
      label: t('mention.category.skills'),
    };
    if (canInstall) {
      categories = mergeIntoCategory(
        categories,
        {
          ...skillCategory,
          items: (marketSkills ?? [])
            .filter((skill) => !installedSkills.has(skill.identifier))
            .map(toMarketSkillItem),
        },
        SKILL_PRECEDING_IDS,
      );
    }

    // --- Tools ---
    const toolItems = enabledSkills.filter((s) => s.category === 'tool');
    if (toolItems.length > 0) {
      categories.push({
        id: 'tool',
        icon: <Icon icon={Wrench} size={16} />,
        items: toolItems.map((item) => ({
          icon: <MentionItemIcon avatar={item.icon} category={'tool'} label={item.label} />,
          key: `tool-${item.type}`,
          label: item.label,
          metadata: {
            actionCategory: item.category,
            actionType: item.type,
            description: item.description,
            timestamp: 0,
            type: 'tool' as const,
          },
        })),
        label: t('mention.category.tools'),
      });
    }

    return {
      categories,
      market: {
        agentCategory,
        agentVisibility,
        agents: marketAgentsEnabled,
        installedAgentSources,
        installedSkills,
        skillCategory,
        skills: canInstall,
      },
    };
  }, [
    pinnedAgents,
    workspaceGroups,
    workspaceUngrouped,
    privateGroups,
    privatePinned,
    privateUngrouped,
    currentAgentId,
    topics,
    activeTopicId,
    isGroupChat,
    externalMentionItems,
    enabledSkills,
    canInstall,
    marketAgentsEnabled,
    marketAgents,
    marketSkills,
    t,
  ]);
};

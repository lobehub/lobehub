import { Avatar, Icon } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { Bot, MessageSquareText, Users, Wrench } from 'lucide-react';
import { useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { useAgentId } from '../hooks/useAgentId';
import { useChatInputStore } from '../store';
import { useInstalledSkillsAndTools } from './ActionTag/useInstalledSkillsAndTools';
import MentionItemIcon from './MentionItemIcon';
import type { MentionCategory } from './MentionMenu/types';

const MAX_AGENT_ITEMS = 20;
const MAX_TOPIC_LABEL = 50;
type MenuOptionWithMetadata = { key: string; metadata?: Record<string, unknown> };

export const useMentionCategories = (): MentionCategory[] => {
  const currentAgentId = useAgentId();
  const allAgents = useHomeStore(homeAgentListSelectors.allAgents);

  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);
  const topicsSelector = useMemo(
    () => topicSelectors.displayTopicsForSidebar(topicPageSize),
    [topicPageSize],
  );
  const topics = useChatStore(topicsSelector);
  const activeTopicId = useChatStore((s) => s.activeTopicId);

  const externalMentionItems = useChatInputStore((s) => s.mentionItems);
  const isGroupChat = !!externalMentionItems;

  const enabledSkills = useInstalledSkillsAndTools();

  return useMemo(() => {
    const categories: MentionCategory[] = [];

    // --- Agents (non-group only) ---
    if (!isGroupChat) {
      const items = allAgents
        .filter((a) => a.type === 'agent' && a.id !== currentAgentId)
        .slice(0, MAX_AGENT_ITEMS)
        .map((agent) => ({
          icon: (
            <Avatar
              avatar={typeof agent.avatar === 'string' ? agent.avatar : undefined}
              background={agent.backgroundColor ?? undefined}
              size={24}
            />
          ),
          key: `agent-${agent.id}`,
          label: agent.title || 'Untitled Agent',
          metadata: {
            id: agent.id,
            timestamp: agent.updatedAt ? new Date(agent.updatedAt).getTime() : 0,
            type: 'agent' as const,
          },
        }));

      if (items.length > 0) {
        categories.push({
          id: 'agent',
          icon: <Icon icon={Bot} size={16} />,
          items,
          label: 'Agents',
        });
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
          label: 'Members',
        });
      }
    }

    // --- Topics ---
    if (topics && topics.length > 0) {
      const items = topics
        .filter((t) => t.id !== activeTopicId)
        .map((topic) => {
          const title = topic.title || 'Untitled';
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
          label: 'Topics',
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
            timestamp: 0,
            type: 'skill' as const,
          },
        })),
        label: 'Skills',
      });
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
            timestamp: 0,
            type: 'tool' as const,
          },
        })),
        label: 'Tools',
      });
    }

    return categories;
  }, [
    allAgents,
    currentAgentId,
    topics,
    activeTopicId,
    isGroupChat,
    externalMentionItems,
    enabledSkills,
  ]);
};

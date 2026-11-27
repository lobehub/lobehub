import { agentDisplayName } from '@lobechat/types';
import type { ISlashMenuOption, ISlashSectionOption } from '@lobehub/editor';

import {
  createTopicCommentMentionItems,
  type MentionableWorkspaceMember,
} from '@/features/Portal/TopicComments/editorUtils';

export interface MentionableAgent {
  avatar?: string | null;
  backgroundColor?: string | null;
  description?: string | null;
  id: string;
  name?: string | null;
  title?: string | null;
}

export type TaskCommentMentionItem = ISlashMenuOption & {
  avatar: { background?: string; value: string };
};

/**
 * The task comment `@` menu: members, then agents, each its own section. An
 * agent mention is a reference in the comment the next run reads; it starts
 * nothing. A personal workspace has no members, so its menu is agents only.
 */
export const createTaskCommentMentionSections = ({
  agents,
  labels,
  members,
  unnamedAgent,
}: {
  agents: MentionableAgent[];
  labels: { agents: string; members: string };
  members: MentionableWorkspaceMember[];
  unnamedAgent: string;
}): (Omit<ISlashSectionOption, 'items'> & { items: TaskCommentMentionItem[] })[] => {
  const memberItems: TaskCommentMentionItem[] = createTopicCommentMentionItems(members).map(
    ({ avatar, ...item }) => ({ ...item, avatar: { value: avatar } }),
  );

  const seen = new Set<string>();
  const agentItems: TaskCommentMentionItem[] = agents.flatMap((agent) => {
    if (!agent.id || seen.has(agent.id)) return [];
    seen.add(agent.id);
    const label = agentDisplayName(agent, unnamedAgent);
    const description = [agent.name ? agent.title : undefined, agent.description]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(' · ');
    return [
      {
        avatar: { background: agent.backgroundColor ?? undefined, value: agent.avatar || label },
        key: `agent-${agent.id}`,
        label,
        metadata: {
          description: description || undefined,
          id: agent.id,
          timestamp: 0,
          type: 'agent',
        },
      },
    ];
  });

  return [
    { items: memberItems, key: 'members', label: labels.members, type: 'section' as const },
    { items: agentItems, key: 'agents', label: labels.agents, type: 'section' as const },
  ].filter((section) => section.items.length > 0);
};

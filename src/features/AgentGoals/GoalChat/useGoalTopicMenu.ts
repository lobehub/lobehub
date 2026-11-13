import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import type { ChatTopicStatus } from '@lobechat/types';
import type { DropdownItem } from '@lobehub/ui';
import { MessageSquareShare } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useDropdownMenu } from '@/features/PageEditor/Copilot/TopicSelector/useDropdownMenu';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

const noop = () => {};

export interface GoalTopicMenuParams {
  agentId: string;
  fav?: boolean;
  status?: ChatTopicStatus | null;
  topicId: string;
  /** The goal is bound to this topic: drop the actions that leave or end it. */
  topicLocked?: boolean;
  topicTitle: string;
}

/**
 * Archiving or deleting the topic switches the shared active topic to a blank
 * one, and duplicating it switches to the copy: each would move a locked panel
 * off the goal's topic (and archiving or deleting would end the record itself).
 */
const LOCKED_HIDDEN_KEYS = new Set(['delete', 'duplicate', 'markCompleted']);

/** Drop leading, trailing and doubled dividers left behind by a filter. */
const tidyDividers = (items: DropdownItem[]) => {
  const isDivider = (item?: DropdownItem) =>
    (item as { type?: string } | undefined)?.type === 'divider';
  const kept: DropdownItem[] = [];
  for (const item of items) {
    if (isDivider(item) && (kept.length === 0 || isDivider(kept.at(-1)))) continue;
    kept.push(item);
  }
  while (isDivider(kept.at(-1))) kept.pop();
  return kept;
};

/** The standard topic menu, led by a jump to the topic's own conversation page. */
export const useGoalTopicMenu = ({
  agentId,
  fav,
  status,
  topicId,
  topicLocked,
  topicTitle,
}: GoalTopicMenuParams): (() => DropdownItem[]) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();

  const topicMenu = useDropdownMenu({
    agentId,
    fav,
    onClose: noop,
    status,
    topicId,
    topicTitle,
  });

  return useCallback(
    () => [
      {
        icon: MessageSquareShare,
        key: 'openTopic',
        label: t('goalChat.openTopic'),
        onClick: () => navigate(AGENT_CHAT_TOPIC_URL(agentId, topicId)),
      },
      { type: 'divider' as const },
      ...(topicLocked
        ? tidyDividers(topicMenu().filter((item) => !LOCKED_HIDDEN_KEYS.has(String(item?.key))))
        : topicMenu()),
    ],
    [agentId, navigate, t, topicId, topicLocked, topicMenu],
  );
};

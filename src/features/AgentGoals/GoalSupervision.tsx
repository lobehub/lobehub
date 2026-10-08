import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { copyToClipboard, type DropdownItem, DropdownMenu, Flexbox } from '@lobehub/ui';
import { ActionIcon, Text, toast } from '@lobehub/ui/base-ui';
import {
  CopyIcon,
  ExternalLink,
  MessagesSquareIcon,
  MoreHorizontal,
  PanelRightCloseIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { ChatList } from '@/features/Conversation';
import MessageItem from '@/features/Conversation/Messages';
import NavHeader from '@/features/NavHeader';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { GoalChatProvider } from './GoalChat/GoalChatProvider';
import GoalConversationInput from './GoalChat/GoalConversationInput';

interface GoalSupervisionProps {
  agentId: string;
  goalId: string;
  /** Sent into the record once it loads — the result page's composer hands off this way. */
  initialMessage?: string;
  onCollapse: () => void;
  onInitialMessageConsumed?: () => void;
  /** Hand the panel back to the agent's editable side conversation. */
  onOpenChat?: () => void;
  topicId: string;
}

/**
 * A management conversation freshly moved to another agent has no turns yet.
 * Say so, instead of leaving the panel with an empty list.
 */
const WaitingForFirstRun = memo(() => {
  const { t } = useTranslation('chat');
  return (
    <Flexbox align={'center'} flex={1} justify={'center'} padding={24}>
      <Text style={{ fontSize: 14, textAlign: 'center' }} type={'secondary'}>
        {t('goalProcess.manager.pending')}
      </Text>
    </Flexbox>
  );
});

WaitingForFirstRun.displayName = 'GoalSupervisionWaiting';

/**
 * The manager's ongoing record, and the place to talk to it. Past turns stay
 * read-only — editing one would rewrite what the manager acted on — but the
 * conversation itself continues here, so the reader never has to leave the goal
 * to answer a question the manager asked in it.
 */
export const GoalSupervision = ({
  agentId,
  goalId,
  initialMessage,
  onCollapse,
  onInitialMessageConsumed,
  onOpenChat,
  topicId,
}: GoalSupervisionProps) => {
  const { t } = useTranslation('chat');
  const useFetchAgentConfig = useAgentStore((s) => s.useFetchAgentConfig);
  useFetchAgentConfig(true, agentId);
  const agentTitle = useAgentStore((s) =>
    agentDisplayName(agentSelectors.getAgentMetaById(agentId)(s)),
  );
  // Stable renderer for the virtualized history; past turns are not editable.
  const itemContent = useCallback(
    (index: number, id: string) => <MessageItem disableEditing id={id} index={index} />,
    [],
  );
  const navigate = useWorkspaceAwareNavigate();
  // Opening the record in the agent's own chat gives it the full page; the id is
  // one click away for referencing it elsewhere (`lh topic view`, a bug report),
  // like a task run's.
  const menuItems = useMemo<DropdownItem[]>(
    () => [
      // A fresh side conversation, for a question that should not land in the
      // manager's own record.
      ...(onOpenChat
        ? [
            {
              icon: MessagesSquareIcon,
              key: 'openChat',
              label: t('goalChat.title'),
              onClick: onOpenChat,
            },
          ]
        : []),
      {
        icon: ExternalLink,
        key: 'openAgentTopic',
        label: t('taskDetail.topicMenu.openAgentTopic'),
        onClick: () => navigate(AGENT_CHAT_TOPIC_URL(agentId, topicId)),
      },
      {
        icon: CopyIcon,
        key: 'copyTopicId',
        label: t('taskDetail.topicMenu.copyId'),
        onClick: async () => {
          await copyToClipboard(topicId);
          toast.success(t('copySuccess', { ns: 'common' }));
        },
      },
    ],
    [agentId, navigate, onOpenChat, t, topicId],
  );

  return (
    <GoalChatProvider agentId={agentId} goalId={goalId} initialTopicId={topicId}>
      <Flexbox height={'100%'} style={{ overflow: 'hidden' }}>
        <NavHeader
          showTogglePanelButton={false}
          left={
            <Flexbox horizontal align={'center'} gap={4} style={{ minWidth: 0 }}>
              <Text ellipsis>{agentTitle || t('goalProcess.manager.title')}</Text>
              <DropdownMenu items={menuItems}>
                <ActionIcon icon={MoreHorizontal} size={'small'} />
              </DropdownMenu>
            </Flexbox>
          }
          right={
            <ActionIcon
              icon={PanelRightCloseIcon}
              size={DESKTOP_HEADER_ICON_SMALL_SIZE}
              title={t('close', { ns: 'common' })}
              onClick={onCollapse}
            />
          }
        />
        <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
          <ChatList disableActionsBar itemContent={itemContent} welcome={<WaitingForFirstRun />} />
        </Flexbox>
        <GoalConversationInput
          initialMessage={initialMessage}
          onInitialMessageConsumed={onInitialMessageConsumed}
        />
      </Flexbox>
    </GoalChatProvider>
  );
};

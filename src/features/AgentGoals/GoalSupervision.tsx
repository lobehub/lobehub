import { agentDisplayName } from '@lobechat/types';
import { copyToClipboard, type DropdownItem, DropdownMenu, Flexbox } from '@lobehub/ui';
import { ActionIcon, Text, toast } from '@lobehub/ui/base-ui';
import { CopyIcon, MoreHorizontal, PanelRightCloseIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { ChatList } from '@/features/Conversation';
import MessageItem from '@/features/Conversation/Messages';
import NavHeader from '@/features/NavHeader';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { GoalChatProvider } from './GoalChat/GoalChatProvider';

interface GoalSupervisionProps {
  agentId: string;
  goalId: string;
  onCollapse: () => void;
  topicId: string;
}

/** The manager's ongoing record is inspectable without sending or editing messages. */
export const GoalSupervision = ({ agentId, goalId, onCollapse, topicId }: GoalSupervisionProps) => {
  const { t } = useTranslation('chat');
  const useFetchAgentConfig = useAgentStore((s) => s.useFetchAgentConfig);
  useFetchAgentConfig(true, agentId);
  const agentTitle = useAgentStore((s) =>
    agentDisplayName(agentSelectors.getAgentMetaById(agentId)(s)),
  );
  // Stable renderer for the virtualized history; disable message editing too,
  // rather than only removing the composer below the list.
  const itemContent = useCallback(
    (index: number, id: string) => <MessageItem disableEditing id={id} index={index} />,
    [],
  );
  // The supervision record is referenced from elsewhere (`lh topic view`, a
  // bug report), so its id is one click away like a task run's.
  const menuItems = useMemo<DropdownItem[]>(
    () => [
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
    [t, topicId],
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
          <ChatList disableActionsBar itemContent={itemContent} />
        </Flexbox>
      </Flexbox>
    </GoalChatProvider>
  );
};

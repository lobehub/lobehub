import { type DropdownItem, DropdownMenu, Flexbox } from '@lobehub/ui';
import { ActionIcon, Button } from '@lobehub/ui/base-ui';
import { CopyIcon, LinkIcon, ListTodo, MoreHorizontal } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskCopyActions } from '@/features/AgentTasks/AgentTaskDetail/useTaskCopyActions';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import PortalHeader from '../components/Header';
import Title from './Title';

const Header = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useChatStore(chatPortalSelectors.taskResultId);
  const openTaskDetail = useChatStore((state) => state.openTaskDetail);
  // The body marks this task active while the panel is open, so the copied
  // link is byte-for-byte the one the task page's own header copies.
  const { copyId, copyLink } = useTaskCopyActions();

  const menuItems = useMemo<DropdownItem[]>(
    () => [
      {
        icon: LinkIcon,
        key: 'copyLink',
        label: t('taskList.contextMenu.copyLink'),
        onClick: copyLink,
      },
      {
        icon: CopyIcon,
        key: 'copyId',
        label: t('taskList.contextMenu.copyId'),
        onClick: copyId,
      },
    ],
    [copyId, copyLink, t],
  );

  return (
    <PortalHeader
      title={<Title />}
      rightExtra={
        <Flexbox horizontal align={'center'} gap={4}>
          <Button
            disabled={!taskId}
            icon={ListTodo}
            size={'small'}
            type={'text'}
            onClick={() => taskId && openTaskDetail(taskId)}
          >
            {t('goalDetail.viewOriginalTask')}
          </Button>
          {taskId && (
            <DropdownMenu items={menuItems}>
              <ActionIcon icon={MoreHorizontal} size={'small'} />
            </DropdownMenu>
          )}
        </Flexbox>
      }
    />
  );
});

Header.displayName = 'TaskResultPortalHeader';
export default Header;

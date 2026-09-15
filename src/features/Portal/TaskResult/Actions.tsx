import { type DropdownItem, DropdownMenu } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { CopyIcon, LinkIcon, MoreHorizontal } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskCopyActions } from '@/features/AgentTasks/AgentTaskDetail/useTaskCopyActions';

/**
 * The "⋯" that rides right behind the task name, the way the goal and
 * supervision headers place theirs — the menu belongs to the thing it names,
 * not to the panel chrome on the far edge.
 */
const Actions = memo(() => {
  const { t } = useTranslation('chat');
  // The body marks this task active while the panel is open, so the copied
  // link is byte-for-byte the one the task page's own header copies.
  const { copyId, copyLink, taskId } = useTaskCopyActions();

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

  if (!taskId) return null;

  return (
    <DropdownMenu items={menuItems}>
      <ActionIcon icon={MoreHorizontal} size={'small'} style={{ flexShrink: 0 }} />
    </DropdownMenu>
  );
});

Actions.displayName = 'TaskResultPortalActions';
export default Actions;

'use client';

import { ActionIcon } from '@lobehub/ui/base-ui';
import { CopyIcon, LinkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';

import { useTaskCopyActions } from './useTaskCopyActions';

/**
 * Copy link / copy ID as one-click header buttons. These are the two clipboard
 * actions people reach for constantly while cross-referencing a task elsewhere,
 * so they sit in the header rather than behind the overflow menu — which still
 * lists them, for discoverability and for parity with the list context menu.
 */
const TaskDetailCopyActions = memo(() => {
  const { t } = useTranslation('chat');

  const { copyId, copyLink, taskId } = useTaskCopyActions();

  if (!taskId) return null;

  return (
    <>
      <ActionIcon
        icon={LinkIcon}
        size={DESKTOP_HEADER_ICON_SMALL_SIZE}
        title={t('taskList.contextMenu.copyLink')}
        tooltipProps={{ placement: 'bottom' }}
        onClick={copyLink}
      />
      <ActionIcon
        icon={CopyIcon}
        size={DESKTOP_HEADER_ICON_SMALL_SIZE}
        title={t('taskList.contextMenu.copyId')}
        tooltipProps={{ placement: 'bottom' }}
        onClick={copyId}
      />
    </>
  );
});

export default TaskDetailCopyActions;

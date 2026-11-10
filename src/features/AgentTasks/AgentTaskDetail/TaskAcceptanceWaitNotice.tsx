'use client';

import type { TaskDetailActivity } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight, Stamp } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useOpenAcceptanceInPanel } from './useOpenAcceptanceInPanel';
import { useRunAcceptanceWait } from './useTaskAcceptanceWait';

// Same weight as the composer's OpStatusTray: one quiet status line, not a banner.
const styles = stylex.create({
  container: {
    color: cssVar.colorTextSecondary,
    fontSize: 12,
    paddingInline: 4,
  },
  link: {
    cursor: 'pointer',
    color: {
      'default': cssVar.colorTextSecondary,
      ':hover': cssVar.colorText,
    },
  },
  icon: {
    color: cssVar.colorWarning,
    flex: 'none',
  },
});

interface TaskAcceptanceWaitNoticeProps {
  /** The run open in the drawer; it may belong to a descendant task. */
  activity?: TaskDetailActivity;
  /** The drawer's live operation, which can arrive before the activity's marker. */
  runningOperation?: TaskDetailActivity['runningOperation'];
}

/**
 * Says why a `running` run is not generating: its agent stopped and the
 * acceptance round bound to it still has to settle.
 */
const TaskAcceptanceWaitNotice = memo<TaskAcceptanceWaitNoticeProps>(
  ({ activity, runningOperation }) => {
    const { t } = useTranslation('chat');
    const openAcceptanceInPanel = useOpenAcceptanceInPanel();

    // Same rule as the run card's status icon, so the drawer and the card agree.
    const runWait = useRunAcceptanceWait(activity);
    const wait = runningOperation ? undefined : runWait;
    if (!wait) return null;

    const { acceptanceId } = wait;

    return (
      <Flexbox
        horizontal
        align={'center'}
        gap={6}
        {...stylex.props(styles.container, !!acceptanceId && styles.link)}
        role={acceptanceId ? 'button' : undefined}
        tabIndex={acceptanceId ? 0 : undefined}
        onClick={acceptanceId ? () => openAcceptanceInPanel(acceptanceId) : undefined}
        onKeyDown={
          acceptanceId
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') openAcceptanceInPanel(acceptanceId);
              }
            : undefined
        }
      >
        <Icon icon={Stamp} size={14} {...stylex.props(styles.icon)} />
        <span>{t('taskDetail.acceptanceWait.title')}</span>
        {acceptanceId && <Icon icon={ChevronRight} size={12} />}
      </Flexbox>
    );
  },
);

TaskAcceptanceWaitNotice.displayName = 'TaskAcceptanceWaitNotice';

export default TaskAcceptanceWaitNotice;

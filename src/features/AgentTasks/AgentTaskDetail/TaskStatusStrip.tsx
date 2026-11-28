'use client';

import type { TaskStatus } from '@lobechat/types';
import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink, Stamp } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';
import { densityTokens } from '@/styles/density.stylex';

import TaskStatusTag from '../features/TaskStatusTag';
import { resolveTaskStatusStripLead } from './resolveTaskStatusStripLead';
import TaskDetailRunPauseAction, { useNextRunCountdown } from './TaskDetailRunPauseAction';
import { useOpenAcceptanceInPanel } from './useOpenAcceptanceInPanel';
import { ACCEPTANCE_STATE_META, useTaskAcceptanceState } from './useTaskAcceptanceState';
import { useTaskAcceptanceWait } from './useTaskAcceptanceWait';

// The buttons stay beside the label while the column has room and wrap under
// it in narrow columns (Portal, beside the agent panel); the label keeps a
// minimum width so it never squeezes down to an ellipsis first.
const styles = stylex.create({
  actions: {
    alignItems: 'center',
    display: { 'default': 'flex', ':empty': 'none' },
    flexShrink: 0,
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: cssVar.colorFillTertiary,
    borderRadius: '50%',
    display: 'flex',
    flexShrink: 0,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  root: {
    alignItems: 'center',
    backgroundColor: cssVar.colorBgContainerSecondary,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    padding: densityTokens['--lobe-density-content-gap'],
  },
  text: {
    flex: '1',
    minWidth: 160,
  },
});

/**
 * Where the task stands and what it needs from you, directly under the title.
 *
 * It carries the run / stop / schedule actions, and while a delivery waits on
 * the human it leads with the acceptance instead: that decision, not another
 * run, is what moves the task forward. The sidebar keeps the editable status.
 */
const TaskStatusStrip = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus) as TaskStatus | undefined;
  const assigneeAgentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const assigneeUserId = useTaskStore(taskDetailSelectors.activeTaskAssigneeUserId);
  const canRun = useTaskStore(taskDetailSelectors.canRunActiveTask);
  const acceptanceWait = useTaskAcceptanceWait();
  const acceptance = useTaskAcceptanceState();
  const countdown = useNextRunCountdown();
  const openAcceptanceInPanel = useOpenAcceptanceInPanel();

  if (!taskId) return null;

  const lead = resolveTaskStatusStripLead(status, !!acceptanceWait, acceptance?.state);
  const needsDecision = lead.kind === 'acceptance' && lead.needsDecision;

  let badge;
  let title: string;
  if (lead.kind === 'acceptance') {
    const meta = ACCEPTANCE_STATE_META[lead.state];
    badge = (
      <Icon color={meta.color} icon={meta.icon} size={18} spin={'spin' in meta && meta.spin} />
    );
    title = t(`taskDetail.acceptanceState.${meta.labelKey}`);
  } else if (lead.kind === 'awaitingAcceptance') {
    badge = <Icon color={ACCEPTANCE_STATE_META.awaitingReview.color} icon={Stamp} size={18} />;
    title = t('taskDetail.status.awaitingAcceptance');
  } else {
    badge = <TaskStatusTag disableDropdown size={18} status={status} taskIdentifier={taskId} />;
    title = t(`taskDetail.status.${status ?? 'backlog'}` as never);
  }

  let subtitle: string | undefined;
  if (countdown) {
    subtitle =
      countdown.type === 'days'
        ? t('taskDetail.nextRunCountdownDays', countdown)
        : t('taskDetail.nextRunCountdown', countdown);
  } else if (canRun && !assigneeAgentId && !assigneeUserId) {
    subtitle = t('taskList.unassignedAgentHint');
  }

  return (
    <div {...stylex.props(styles.root)} role={'status'}>
      <Flexbox horizontal align={'center'} gap={12} {...stylex.props(styles.text)}>
        <span {...stylex.props(styles.badge)}>{badge}</span>
        <Flexbox style={{ minWidth: 0 }}>
          <Text ellipsis weight={600}>
            {title}
          </Text>
          {subtitle && (
            <Text ellipsis fontSize={12} type={'secondary'}>
              {subtitle}
            </Text>
          )}
        </Flexbox>
      </Flexbox>
      <div {...stylex.props(styles.actions)}>
        <TaskDetailRunPauseAction emphasis={needsDecision ? 'default' : 'primary'} />
        {lead.kind === 'acceptance' && acceptance && (
          <Button
            icon={needsDecision ? Stamp : ExternalLink}
            type={needsDecision ? 'primary' : 'default'}
            onClick={() => openAcceptanceInPanel(acceptance.acceptanceId)}
          >
            {needsDecision
              ? t('taskDetail.statusStrip.openAcceptance')
              : t('taskDetail.acceptance.openReport')}
          </Button>
        )}
      </div>
    </div>
  );
});

TaskStatusStrip.displayName = 'TaskStatusStrip';

export default TaskStatusStrip;

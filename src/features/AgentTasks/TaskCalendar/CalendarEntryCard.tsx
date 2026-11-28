import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import {
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock,
  LoaderCircle,
  type LucideIcon,
} from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import type { TaskItemRouteScope } from '../features/AgentTaskItem';
import { taskDetailPath } from '../shared/taskDetailPath';
import { useTaskListOriginState } from '../shared/taskListOrigin';
import type { CalendarRunOutcome, TaskCalendarEntry } from './calendarModel';

type EntryStatus = CalendarRunOutcome | 'completed' | 'planned';

const STATUS_VISUALS: Record<EntryStatus, { color: string; icon: LucideIcon }> = {
  completed: { color: cssVar.colorSuccess, icon: CircleCheck },
  failed: { color: cssVar.colorError, icon: CircleX },
  planned: { color: cssVar.colorTextTertiary, icon: Clock },
  running: { color: cssVar.colorWarning, icon: LoaderCircle },
  skipped: { color: cssVar.colorTextTertiary, icon: CircleMinus },
  succeeded: { color: cssVar.colorSuccess, icon: CircleCheck },
};

const STATUS_LABEL_KEYS = {
  completed: 'taskList.calendar.status.completed',
  failed: 'taskList.calendar.status.failed',
  planned: 'taskList.calendar.status.planned',
  running: 'taskList.calendar.status.running',
  skipped: 'taskList.calendar.status.skipped',
  succeeded: 'taskList.calendar.status.succeeded',
} as const satisfies Record<EntryStatus, string>;

const entryStatus = (entry: TaskCalendarEntry): EntryStatus =>
  entry.kind === 'run' ? entry.outcome : entry.kind;

const styles = stylex.create({
  card: {
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorFillTertiary },
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 6,
    borderStyle: 'solid',
    borderWidth: 1,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    font: 'inherit',
    gap: 2,
    minWidth: 0,
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '-2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    paddingBlock: 3,
    paddingInline: 6,
    textAlign: 'start',
    transition: 'background-color 150ms ease-out',
    width: '100%',
  },
  failed: {
    borderColor: cssVar.colorErrorBorder,
  },
  head: {
    alignItems: 'center',
    display: 'flex',
    gap: 4,
    minWidth: 0,
  },
  // The short note a run left, set like a hand-written margin note.
  note: {
    color: cssVar.colorTextSecondary,
    fontFamily:
      "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Kaiti SC', STKaiti, KaiTi, cursive",
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 1.4,
    overflow: 'hidden',
    paddingInlineStart: 16,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // A planned run has not happened yet: a dashed outline on a quiet surface.
  planned: {
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillQuaternary },
    borderStyle: 'dashed',
  },
  time: {
    color: cssVar.colorTextTertiary,
    flex: 'none',
    fontSize: 11,
    fontVariantNumeric: 'tabular-nums',
  },
});

interface CalendarEntryCardProps {
  entry: TaskCalendarEntry;
  routeScope: TaskItemRouteScope;
}

/**
 * One run, planned run or completed task on the calendar: when, what, who ran
 * it and how it went. A past run opens its own conversation; anything else
 * opens the task.
 */
export const CalendarEntryCard = memo<CalendarEntryCardProps>(({ entry, routeScope }) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const taskListOriginState = useTaskListOriginState();
  const { task } = entry;
  const status = entryStatus(entry);
  const visual = STATUS_VISUALS[status];
  const statusLabel = t(STATUS_LABEL_KEYS[status]);
  const assignee = task.participants.find((participant) => participant.type === 'agent');
  // A past run belongs to the agent that ran it, which a reassignment since
  // then does not change.
  const runAgentId = entry.kind === 'run' ? (entry.run.agentId ?? task.assigneeAgentId) : null;
  const agentId = runAgentId ?? assignee?.id;
  const agent = assignee && assignee.id === agentId ? assignee : undefined;
  const name = task.name?.trim() || task.identifier;
  const time = dayjs(entry.at).format('HH:mm');
  const note = entry.kind === 'run' ? entry.run.note : null;
  const runTopicId = entry.kind === 'run' ? entry.run.topicId : null;

  const handleClick = useCallback(() => {
    if (runTopicId && runAgentId) {
      navigate(AGENT_CHAT_TOPIC_URL(runAgentId, runTopicId));
      return;
    }
    navigate(
      taskDetailPath(
        task.identifier,
        routeScope === 'agent' ? (task.assigneeAgentId ?? undefined) : undefined,
        task.name,
      ),
      { state: taskListOriginState },
    );
  }, [navigate, routeScope, runAgentId, runTopicId, task, taskListOriginState]);

  const label = t('taskList.calendar.cardLabel', { name, status: statusLabel, time });

  return (
    <Tooltip title={note ? `${label}\n${note}` : label}>
      <button
        aria-label={label}
        data-entry-kind={entry.kind}
        type={'button'}
        {...stylex.props(
          styles.card,
          entry.kind === 'planned' && styles.planned,
          status === 'failed' && styles.failed,
        )}
        onClick={handleClick}
      >
        <span {...stylex.props(styles.head)}>
          <Icon color={visual.color} icon={visual.icon} size={12} spin={status === 'running'} />
          <span {...stylex.props(styles.time)}>{time}</span>
          {agentId && (
            <AgentAvatar
              agentId={agentId}
              avatar={agent?.avatar}
              name={agent?.title}
              shape={'circle'}
              size={16}
              style={{ flex: 'none' }}
            />
          )}
          <Text ellipsis fontSize={12} style={{ minWidth: 0 }}>
            {name}
          </Text>
        </span>
        {note && <span {...stylex.props(styles.note)}>{note}</span>}
      </button>
    </Tooltip>
  );
});

CalendarEntryCard.displayName = 'TaskCalendarEntryCard';

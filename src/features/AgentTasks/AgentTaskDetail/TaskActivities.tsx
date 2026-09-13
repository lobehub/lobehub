import type {
  BriefType,
  TaskAutomationSnapshot,
  TaskDetailActivity,
  TaskDetailActivityAuthor,
} from '@lobechat/types';
import { Empty, Flexbox, Icon } from '@lobehub/ui';
import { Accordion, Avatar, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRightLeft,
  BotMessageSquare,
  CircleDot,
  CirclePlus,
  MessageCircle,
  Timer,
  UserRoundCog,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import type { BriefItem } from '@/features/DailyBrief/types';
import { useActivityTime } from '@/hooks/useActivityTime';
import { useTaskStore } from '@/store/task';
import { taskActivitySelectors, taskDetailSelectors } from '@/store/task/selectors';

import { PRIORITY_META } from '../features/TaskPriorityTag';
import { styles } from '../shared/style';
import { resolveAssignmentActivityCopy } from './assignmentActivityCopy';
import CommentCard from './CommentCard';
import CommentInput from './CommentInput';
import TaskBriefCard from './TaskBriefCard';
import TaskRunReport from './TaskRunReport';
import TopicCard from './TopicCard';

const PRIORITY_NAME: Record<number, 'high' | 'low' | 'none' | 'normal' | 'urgent'> = {
  0: 'none',
  1: 'urgent',
  2: 'high',
  3: 'normal',
  4: 'low',
};

const ROW_TYPE_ICON = {
  assignment: UserRoundCog,
  property: ArrowRightLeft,
  comment: MessageCircle,
  created: CirclePlus,
  topic: CircleDot,
} as const;

/** Convert a brief-type activity to the BriefItem shape expected by BriefCard. */
const toBriefItem = (act: TaskDetailActivity): BriefItem | null => {
  if (!act.id || !act.briefType) return null;
  return {
    actions: (act.actions ?? null) as BriefItem['actions'],
    agent: act.agent
      ? {
          avatar: act.agent.avatar,
          backgroundColor: act.agent.backgroundColor,
          id: act.agent.id,
          name: act.agent.name ?? null,
          title: act.agent.title ?? null,
        }
      : null,
    agentId: act.agentId ?? null,
    artifacts: act.artifacts ?? null,
    createdAt: act.createdAt ?? act.time ?? new Date().toISOString(),
    cronJobId: act.cronJobId ?? null,
    id: act.id,
    priority: act.priority ?? null,
    readAt: act.readAt ?? null,
    resolvedAction: act.resolvedAction ?? null,
    resolvedAt: act.resolvedAt ?? null,
    resolvedComment: act.resolvedComment ?? null,
    summary: act.summary ?? '',
    taskId: act.taskId ?? null,
    title: act.title ?? '',
    topicId: act.topicId ?? null,
    type: act.briefType as BriefType,
    userId: act.userId ?? '',
  };
};

const getRowText = (act: TaskDetailActivity, t: TFunction<'chat'>): string => {
  if (act.type === 'comment') return act.content || t('taskDetail.activities.fallback.comment');
  if (act.type === 'topic') return act.title || t('taskDetail.activities.fallback.topic');
  if (act.type === 'created') return t('taskDetail.activities.fallback.created');
  return '';
};

/**
 * A participant's name inside a feed sentence — the actor of a row, or the
 * target of an assignment. Just the name: the line's mark is the type icon,
 * so both "A assigned the task to B" and "A moved from X to Y" read as one
 * quiet sentence the way an issue tracker's history does.
 */
const ActivityAuthor = memo<{
  author?: TaskDetailActivityAuthor | null;
  /** Shown when there is no author at all — an assignment nobody requested. */
  fallbackName?: string;
  /** Shown when the id is recorded but no live row backs it. */
  unresolvedName?: string;
}>(({ author, fallbackName, unresolvedName }) => {
  const { t } = useTranslation('chat');
  const isAgent = author?.type === 'agent';
  // Three states, deliberately not collapsed: no author is the system; a
  // recorded id with no live row is gone or invisible to this viewer; a
  // resolved row with an empty display name is still a real participant and
  // must not borrow either of the other two labels.
  const name = author
    ? author.name ||
      (author.unresolved
        ? unresolvedName
        : t('taskDetail.activities.assignment.unnamedParticipant'))
    : fallbackName;

  if (!name) return null;
  if (!isAgent || !author?.id) return <span>{name}</span>;

  return (
    <AgentProfilePopup
      agent={{ avatar: author.avatar, title: author.name }}
      agentId={author.id}
      trigger={'hover'}
    >
      <span className={styles.agentAuthorName}>{name}</span>
    </AgentProfilePopup>
  );
});

const RelativeTime = memo<{ time?: string }>(({ time }) => {
  const { text, title } = useActivityTime(time);
  if (!text) return null;
  return (
    <span style={{ color: cssVar.colorTextQuaternary, marginInlineStart: 4 }} title={title}>
      · {text}
    </span>
  );
});

/**
 * One line of the timeline: a 16px mark on the rail, then a single sentence
 * in one tone with the time at its end. Every compact row goes through here
 * so the rail lines up whatever the row is about.
 */
const FeedLine = memo<{ children: ReactNode; mark: ReactNode; time?: string }>(
  ({ children, mark, time }) => (
    <Flexbox horizontal align={'center'} className={styles.activityLine} gap={8}>
      <div className={styles.activityMark}>{mark}</div>
      <Text ellipsis style={{ color: cssVar.colorTextSecondary, flex: 1, minWidth: 0 }}>
        {children}
        <RelativeTime time={time} />
      </Text>
    </Flexbox>
  ),
);

/**
 * The mark on the rail: the actor's face when we have one, otherwise an icon
 * for the kind of change — the face says who, the icon only says what.
 */
const RowMark = ({
  author,
  icon,
}: {
  author?: TaskDetailActivityAuthor | null;
  icon: LucideIcon;
}) =>
  author?.avatar ? (
    <Avatar avatar={author.avatar} size={16} />
  ) : (
    <Icon color={cssVar.colorTextTertiary} icon={icon} size={14} />
  );

/** Compact one-line row for created / topic / comment bookkeeping. */
const ActivityRow = memo<{ activity: TaskDetailActivity }>(({ activity }) => {
  const { t } = useTranslation('chat');
  const TypeIcon = ROW_TYPE_ICON[activity.type as keyof typeof ROW_TYPE_ICON] ?? MessageCircle;
  const text = getRowText(activity, t);
  const author = activity.author;

  return (
    <FeedLine mark={<RowMark author={author} icon={TypeIcon} />} time={activity.time}>
      {author && (
        <>
          <ActivityAuthor author={author} />{' '}
        </>
      )}
      {text}
    </FeedLine>
  );
});

/**
 * "Alice assigned the task to Bob" / "Alice removed the agent" — the durable
 * trace of a reassignment, which otherwise only shows up as a silently changed
 * chip in the header.
 */
const AssignmentRow = memo<{ activity: TaskDetailActivity }>(({ activity }) => {
  const { t } = useTranslation('chat');
  const assignment = activity.assignment;
  const isAgentSlot = assignment?.kind === 'agent';
  const { deletedTargetKey, systemActorKey, verbKey } = resolveAssignmentActivityCopy(assignment);

  return (
    <FeedLine
      time={activity.time}
      mark={
        <RowMark author={activity.author} icon={isAgentSlot ? BotMessageSquare : UserRoundCog} />
      }
    >
      {/*
        The whole line is one translated sentence rather than actor + verb +
        target concatenated in the DOM: verb-final languages (ja, ko, …) put
        the target before the verb, which fixed node order cannot express.
      */}
      <Trans
        i18nKey={verbKey}
        ns={'chat'}
        components={{
          actor: (
            <ActivityAuthor
              author={activity.author}
              fallbackName={t(systemActorKey)}
              unresolvedName={t(
                activity.author?.type === 'agent'
                  ? 'taskDetail.activities.assignment.deletedAgent'
                  : 'taskDetail.activities.assignment.deletedMember',
              )}
            />
          ),
          target: <ActivityAuthor author={assignment?.to} unresolvedName={t(deletedTargetKey)} />,
        }}
      />
    </FeedLine>
  );
});

interface TaskActivitiesProps {
  /** Result review leads with run output and leaves the reply composer after the evidence. */
  variant?: 'activity' | 'result';
}

const PROPERTY_ICON: Record<'automation' | 'status', LucideIcon> = {
  automation: Timer,
  status: CircleDot,
};

const PriorityMark = ({ level }: { level: number | null }) => {
  const meta = PRIORITY_META[level ?? 0] ?? PRIORITY_META[0];
  const IconRender = meta.icon;
  return (
    <IconRender color={meta.level === 1 ? cssVar.orange : cssVar.colorTextTertiary} size={14} />
  );
};

/**
 * "<actor> changed the status from <from> to <to>" and its priority /
 * automation siblings. A collapsed entry can span several hops, so the
 * starting value is what tells the reader how far the property moved. Only a
 * change a person (or their agent) made reaches the feed — the runner's own
 * start / finish transitions are already told by the run row.
 */
const PropertyRow = memo<{ activity: TaskDetailActivity }>(({ activity }) => {
  const { t } = useTranslation('chat');
  const change = activity.propertyChange;
  if (!change) return null;

  const actor = (
    <ActivityAuthor
      author={activity.author}
      fallbackName={t('taskDetail.activities.assignment.systemActor')}
      unresolvedName={t(
        activity.author?.type === 'agent'
          ? 'taskDetail.activities.assignment.deletedAgent'
          : 'taskDetail.activities.assignment.deletedMember',
      )}
    />
  );
  // Values are words in the sentence, in the same tone as the rest of it.
  const value = (label: ReactNode) => <span>{label}</span>;
  // A schedule is pattern + timezone + cap; naming only the pattern would
  // make a timezone-only edit read as "from X to X". The extra parts are
  // machine values, so they ride outside the translated phrase.
  const automationLabel = (snapshot: TaskAutomationSnapshot) =>
    snapshot.mode === 'schedule'
      ? [
          t('taskDetail.activities.automation.mode.schedule', {
            pattern: snapshot.schedulePattern ?? '',
          }),
          snapshot.scheduleTimezone,
          typeof snapshot.maxExecutions === 'number' ? `×${snapshot.maxExecutions}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : t('taskDetail.activities.automation.mode.heartbeat', {
          seconds: snapshot.heartbeatInterval ?? 0,
        });

  let sentence: ReactNode;
  switch (change.field) {
    case 'status': {
      sentence = (
        <Trans
          i18nKey={'taskDetail.activities.status.changed'}
          ns={'chat'}
          components={{
            actor,
            from: value(change.from ? t(`taskDetail.status.${change.from}`) : '—'),
            to: value(t(`taskDetail.status.${change.to}`)),
          }}
        />
      );
      break;
    }
    case 'priority': {
      const priorityLabel = (level: number | null) =>
        value(t(`taskDetail.priority.${PRIORITY_NAME[level ?? 0] ?? 'none'}`));
      sentence = (
        <Trans
          components={{ actor, from: priorityLabel(change.from), to: priorityLabel(change.to) }}
          i18nKey={'taskDetail.activities.priority.changed'}
          ns={'chat'}
        />
      );
      break;
    }
    case 'automation': {
      const { from, to } = change;
      // Three shapes, one per direction: turned on, turned off, reconfigured.
      sentence =
        from && to ? (
          <Trans
            i18nKey={'taskDetail.activities.automation.changed'}
            ns={'chat'}
            components={{
              actor,
              from: value(automationLabel(from)),
              to: value(automationLabel(to)),
            }}
          />
        ) : to ? (
          <Trans
            components={{ actor, value: value(automationLabel(to)) }}
            i18nKey={'taskDetail.activities.automation.set'}
            ns={'chat'}
          />
        ) : (
          <Trans
            components={{ actor }}
            i18nKey={'taskDetail.activities.automation.off'}
            ns={'chat'}
          />
        );
      break;
    }
  }

  return (
    <FeedLine
      // A property row is about the property, so its mark is the property's
      // icon — the face is for rows about people (created, assigned). Priority
      // uses the app's own solid bars, at the level it moved to.
      time={activity.time}
      mark={
        change.field === 'priority' ? (
          <PriorityMark level={change.to} />
        ) : (
          <RowMark icon={PROPERTY_ICON[change.field]} />
        )
      }
    >
      {sentence}
    </FeedLine>
  );
});

const TaskActivities = memo<TaskActivitiesProps>(({ variant = 'activity' }) => {
  const { t } = useTranslation('chat');
  const activities = useTaskStore(taskActivitySelectors.activeTaskActivities);
  const activeTaskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const refreshTaskDetail = useTaskStore((s) => s.internal_refreshTaskDetail);

  const refreshActiveTask = useCallback(async () => {
    if (activeTaskId) await refreshTaskDetail(activeTaskId);
  }, [activeTaskId, refreshTaskDetail]);

  const items = useMemo(
    () =>
      activities
        .map((act, i) => ({
          activity: act,
          brief: act.type === 'brief' ? toBriefItem(act) : null,
          key: act.id ?? `activity-${i}`,
        }))
        .reverse(),
    [activities],
  );

  const commentInput = activeTaskId ? <CommentInput taskId={activeTaskId} /> : null;

  // A goal loop can produce many rounds; only the newest run opens by default so
  // the latest result is not buried under older ones.
  const firstTopicKey = items.find(({ activity }) => activity.type === 'topic')?.key;
  // Compact lines that sit next to each other share one rail, so the marks
  // read as a timeline; a card (comment, run, brief) breaks the rail.
  const withRail = (nodes: ReactNode[]): ReactNode[] => {
    const out: ReactNode[] = [];
    let run: ReactNode[] = [];
    const flush = () => {
      if (run.length === 0) return;
      out.push(
        <Flexbox className={styles.activityTimeline} key={`rail-${out.length}`}>
          {run}
        </Flexbox>,
      );
      run = [];
    };
    for (const node of nodes) {
      if (node === null || node === undefined) continue;
      const isLine =
        typeof node === 'object' &&
        'type' in node &&
        (node.type === PropertyRow || node.type === AssignmentRow || node.type === ActivityRow);
      if (isLine) run.push(node);
      else {
        flush();
        out.push(node);
      }
    }
    flush();
    return out;
  };

  const rows =
    items.length > 0 ? (
      withRail(
        items.map(({ activity, brief, key }) => {
          if (brief) {
            return (
              <TaskBriefCard
                brief={brief}
                key={key}
                onAfterAddComment={refreshActiveTask}
                onAfterDelete={refreshActiveTask}
                onAfterResolve={refreshActiveTask}
              />
            );
          }
          if (activity.type === 'topic') {
            // The result panel's newest run is not a row in a list — it is the
            // agent's report of what this task produced, so it gets its own
            // presentation rather than the activity card's chrome.
            if (variant === 'result' && key === firstTopicKey) {
              return <TaskRunReport activity={activity} key={key} />;
            }
            return <TopicCard activity={activity} defaultExpanded={false} key={key} />;
          }
          if (activity.type === 'comment') {
            return <CommentCard activity={activity} key={key} />;
          }
          // Lifecycle bookkeeping ("created the task", reassignments). It belongs
          // to the activity timeline; in a result panel it is a row between the
          // reader and the report.
          if (variant === 'result') return null;
          if (activity.type === 'property') {
            return <PropertyRow activity={activity} key={key} />;
          }
          if (activity.type === 'assignment') {
            return <AssignmentRow activity={activity} key={key} />;
          }
          return <ActivityRow activity={activity} key={key} />;
        }),
      )
    ) : (
      <Empty
        description={t('taskDetail.activitiesEmpty')}
        icon={BotMessageSquare}
        style={{ marginTop: 8 }}
      />
    );

  // The Portal header already names the task and the report is the only thing
  // in this section, so a collapsible "运行结果" band above it labels a section
  // of one and eats the top of the reading surface.
  // No comment composer here: the result panel is for reading what came back.
  // Leaving a note for the next run is one of the report's own actions, which
  // opens the editor on demand instead of parking an empty box under every
  // report.
  if (variant === 'result') return <Flexbox gap={12}>{rows}</Flexbox>;

  return (
    <Accordion
      defaultValue={['activities']}
      gap={0}
      styles={{ header: { paddingBlock: 4, paddingInline: 8 } }}
      items={[
        {
          children: (
            <Flexbox gap={12} paddingBlock={12} paddingInline={12}>
              {commentInput}
              {rows}
            </Flexbox>
          ),
          key: 'activities',
          title: (
            <Flexbox horizontal align="center" gap={8}>
              <Icon color={cssVar.colorTextDescription} icon={BotMessageSquare} size={16} />
              <Text color={cssVar.colorTextSecondary} fontSize={13} weight={500}>
                {t('taskDetail.activities')}
              </Text>
            </Flexbox>
          ),
        },
      ]}
    />
  );
});

export default TaskActivities;

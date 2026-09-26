import type { GoalEventType, GoalGraphEvent, GoalNodeKind } from '@lobechat/types';
import { Empty, Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import {
  Archive,
  Check,
  History,
  Link2,
  type LucideIcon,
  Pencil,
  Play,
  Plus,
  Settings2,
  Unlink,
  X,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AssigneeProfileAvatar from '@/features/AgentGoals/ProcessControl/AssigneeProfileAvatar';
import type {
  GoalGraphView,
  GoalNodeView,
} from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';
import { KIND_ICON } from '@/features/AgentGoals/ProcessControl/shared';
import { useGoalNodeSelect } from '@/features/AgentGoals/ProcessControl/useGoalProcessActions';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { goalSelectors, useGoalStore } from '@/store/goal';

/**
 * The goal's history as a timeline, newest first and grouped by day. Each event
 * reads as one sentence — who, did what, to which node — with the node's kind
 * named in the verb ("创建任务 X", "得出结论 X") and marked by a gray kind glyph
 * for a quick scan — never coded in color. Only the leading glyph carries tone:
 * a resolve reads green, a reject red, everything else stays neutral, so the eye
 * can skim the outcomes.
 */

const BADGE = 20;

const styles = createStaticStyles(({ css }) => ({
  badge: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: ${BADGE}px;
    height: ${BADGE}px;
    border-radius: 50%;
  `,
  day: css`
    position: sticky;
    z-index: 1;
    inset-block-start: 0;

    padding-block: 6px;

    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorBgContainer};
  `,
  item: css`
    position: relative;
    padding-block-end: 14px;

    /* The rail: runs from under this badge to the next one. */
    &:not(:last-child)::before {
      content: '';

      position: absolute;
      inset-block: ${BADGE + 4}px 2px;
      inset-inline-start: ${BADGE / 2 - 0.5}px;

      width: 1px;

      background: ${cssVar.colorBorderSecondary};
    }
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-variant-numeric: tabular-nums;
  `,
  reason: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    padding-block: 6px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;

    background: ${cssVar.colorFillQuaternary};
  `,
  subject: css`
    cursor: pointer;

    overflow: hidden;
    display: inline-flex;
    gap: 6px;
    align-items: center;

    min-width: 0;
    padding-block: 1px;
    padding-inline: 6px;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorText};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  subjectTitle: css`
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface Tone {
  bg: string;
  fg: string;
}

const NEUTRAL: Tone = { bg: cssVar.colorFillTertiary, fg: cssVar.colorTextSecondary };

const EVENT_VISUAL: Record<GoalEventType, { icon: LucideIcon; tone: Tone }> = {
  // Starting an attempt is progress, not an outcome — it stays neutral so only
  // resolve / reject carry color.
  activated: { icon: Play, tone: NEUTRAL },
  created: { icon: Plus, tone: NEUTRAL },
  linked: { icon: Link2, tone: NEUTRAL },
  rejected: { icon: X, tone: { bg: cssVar.colorErrorBg, fg: cssVar.colorError } },
  resolved: { icon: Check, tone: { bg: cssVar.colorSuccessBg, fg: cssVar.colorSuccess } },
  retired: { icon: Archive, tone: NEUTRAL },
  unlinked: { icon: Unlink, tone: NEUTRAL },
  updated: { icon: Pencil, tone: NEUTRAL },
};

/**
 * The node an event is about. Events carry the id of whatever row they touched,
 * so a decision or task event is walked back to the graph node that owns it.
 */
const subjectNodes = (event: GoalGraphEvent, graph: GoalGraphView): GoalNodeView[] => {
  const { entityId, entityType } = event;
  const byId = (id: string | undefined) => (id ? graph.byId[id] : undefined);
  let nodes: (GoalNodeView | undefined)[] = [];

  switch (entityType) {
    case 'node': {
      nodes = [byId(entityId)];
      break;
    }
    case 'decision': {
      nodes = [byId(graph.decisions.find((decision) => decision.id === entityId)?.nodeId)];
      break;
    }
    case 'task': {
      nodes = [graph.nodes.find((view) => view.node.taskId === entityId)];
      break;
    }
    case 'edge': {
      const edge = graph.edges.find((item) => item.id === entityId);
      nodes = [byId(edge?.sourceNodeId), byId(edge?.targetNodeId)];
      break;
    }
    default: {
      break;
    }
  }

  return nodes.filter((view): view is GoalNodeView => !!view);
};

/** Verb + kind pairs that read better as their own phrase than as the template. */
const ACTION_PHRASES = new Set([
  'created.decision',
  'created.finding',
  'created.problem',
  'resolved.decision',
  'resolved.problem',
]);

/**
 * The event's kind: the node it touched, or the goal itself. A link joins two
 * nodes, so it has none.
 */
const eventKind = (
  event: GoalGraphEvent,
  subjects: GoalNodeView[],
): GoalNodeKind | 'goal' | undefined => {
  if (event.entityType === 'goal') return 'goal';
  if (event.entityType === 'edge') return undefined;
  return subjects[0]?.node.kind;
};

const Subject = memo<{ onSelect: (nodeId: string) => void; view: GoalNodeView }>(
  ({ onSelect, view }) => (
    <span className={styles.subject} onClick={() => onSelect(view.node.id)}>
      <Icon color={cssVar.colorTextTertiary} icon={KIND_ICON[view.node.kind]} size={13} />
      <span className={styles.subjectTitle}>{view.node.title}</span>
    </span>
  ),
);

Subject.displayName = 'GoalMetricLifecycleSubject';

const AgentActor = memo<{ agentId: string }>(({ agentId }) => {
  const { t } = useTranslation('chat');
  const meta = useAgentDisplayMeta(agentId);

  // The node titles give way first — who acted stays readable, and only a very
  // long agent name is capped.
  return (
    <Flexbox horizontal align={'center'} flex={'none'} gap={6}>
      <AssigneeProfileAvatar agentId={agentId} size={16} />
      <Text ellipsis fontSize={13} style={{ maxWidth: 120 }} weight={500}>
        {meta?.title ?? t('goalProcess.actor.agent')}
      </Text>
    </Flexbox>
  );
});

AgentActor.displayName = 'GoalMetricLifecycleAgentActor';

const Actor = memo<{ event: GoalGraphEvent }>(({ event }) => {
  const { t } = useTranslation('chat');
  if (event.actorType === 'agent' && event.actorId) return <AgentActor agentId={event.actorId} />;

  return (
    <Flexbox horizontal align={'center'} flex={'none'} gap={6}>
      {event.actorType === 'system' && (
        <Icon color={cssVar.colorTextTertiary} icon={Settings2} size={14} />
      )}
      <Text fontSize={13} weight={500}>
        {t(`goalProcess.actor.${event.actorType}` as const)}
      </Text>
    </Flexbox>
  );
});

Actor.displayName = 'GoalMetricLifecycleActor';

const EventItem = memo<{
  event: GoalGraphEvent;
  graph: GoalGraphView;
  onSelect: (nodeId: string) => void;
}>(({ event, graph, onSelect }) => {
  const { t } = useTranslation('chat');
  const { icon, tone } = EVENT_VISUAL[event.eventType] ?? {
    icon: History,
    tone: NEUTRAL,
  };
  const subjects = subjectNodes(event, graph);
  const kind = eventKind(event, subjects);
  const phrase = `${event.eventType}.${kind}`;
  const action = ACTION_PHRASES.has(phrase)
    ? t(`goalProcess.lifecycle.action.${phrase}` as any)
    : t(`goalProcess.lifecycle.action.${event.eventType}` as const, {
        kind: kind ? t(`goalProcess.lifecycle.kind.${kind}` as const) : '',
      }).trim();

  return (
    <Flexbox horizontal className={styles.item} gap={10}>
      <span className={styles.badge} style={{ background: tone.bg }}>
        <Icon color={tone.fg} icon={icon} size={12} />
      </span>
      <Flexbox flex={1} gap={6} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={6} style={{ minHeight: BADGE, minWidth: 0 }}>
          <Actor event={event} />
          <Text fontSize={13} style={{ flex: 'none' }} type={'secondary'}>
            {action}
          </Text>
          {subjects.map((view, index) => (
            <Flexbox
              horizontal
              align={'center'}
              gap={2}
              key={view.node.id}
              style={{ flexShrink: 1, minWidth: 0 }}
            >
              {index > 0 && (
                <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
                  →
                </Text>
              )}
              <Subject view={view} onSelect={onSelect} />
            </Flexbox>
          ))}
          <Text
            className={styles.mono}
            fontSize={12}
            style={{ flex: 'none', marginInlineStart: 'auto', paddingInlineStart: 8 }}
            title={dayjs(event.createdAt).format('YYYY-MM-DD HH:mm:ss')}
            type={'secondary'}
          >
            {dayjs(event.createdAt).format('HH:mm')}
          </Text>
        </Flexbox>
        {event.reason && (
          <div className={styles.reason} title={event.reason}>
            {event.reason}
          </div>
        )}
      </Flexbox>
    </Flexbox>
  );
});

EventItem.displayName = 'GoalMetricLifecycleEvent';

const useDayLabel = () => {
  const { t } = useTranslation('common');
  return (day: dayjs.Dayjs) => {
    const today = dayjs().startOf('day');
    if (day.isSame(today)) return t('time.today');
    if (day.isSame(today.subtract(1, 'day'))) return t('time.yesterday');
    return day.format(
      day.year() === today.year() ? t('time.formatThisYear') : t('time.formatOtherYear'),
    );
  };
};

const Lifecycle = memo<{ goalId: string; graph: GoalGraphView }>(({ goalId, graph }) => {
  const { t } = useTranslation('chat');
  const dayLabel = useDayLabel();
  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));
  // Same landing as a click anywhere else on the goal: a Task opens its Task
  // panel, other nodes their drill-down.
  const onSelect = useGoalNodeSelect(goalId, graph);

  const days = useMemo(() => {
    const sorted = [...(snapshot?.events ?? [])].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const groups: { day: dayjs.Dayjs; events: GoalGraphEvent[] }[] = [];
    for (const event of sorted) {
      const day = dayjs(event.createdAt).startOf('day');
      const last = groups.at(-1);
      if (last?.day.isSame(day)) last.events.push(event);
      else groups.push({ day, events: [event] });
    }
    return groups;
  }, [snapshot]);

  if (days.length === 0)
    return <Empty description={t('goalProcess.metricDetail.lifecycle.empty')} icon={History} />;

  return (
    <Flexbox gap={8}>
      {days.map(({ day, events }) => (
        <Flexbox gap={4} key={day.valueOf()}>
          <div className={styles.day}>{dayLabel(day)}</div>
          <Flexbox gap={0}>
            {events.map((event) => (
              <EventItem event={event} graph={graph} key={event.id} onSelect={onSelect} />
            ))}
          </Flexbox>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

Lifecycle.displayName = 'GoalMetricLifecycle';

export default Lifecycle;

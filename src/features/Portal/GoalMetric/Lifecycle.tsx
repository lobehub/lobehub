import type { GoalEventType, GoalGraphEvent, GoalNodeKind } from '@lobechat/types';
import { createStaticStyles, cssVar, cx, Empty, Flexbox, Icon, Text } from '@lobehub/ui';
import { GithubIcon } from '@lobehub/ui/icons';
import dayjs from 'dayjs';
import {
  Archive,
  ArrowUpRight,
  Ban,
  Check,
  GitPullRequest,
  History,
  Link2,
  type LucideIcon,
  PackageCheck,
  Pause,
  Pencil,
  Play,
  Plus,
  Unlink,
  X,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AssigneeProfileAvatar from '@/features/AgentGoals/ProcessControl/AssigneeProfileAvatar';
import {
  artifactIconOf,
  openTargetOf,
  useOpenGoalArtifact,
} from '@/features/AgentGoals/ProcessControl/Deliverables';
import type {
  GoalArtifactView,
  GoalGraphView,
  GoalNodeView,
} from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';
import { KIND_ICON } from '@/features/AgentGoals/ProcessControl/shared';
import { useGoalNodeSelect } from '@/features/AgentGoals/ProcessControl/useGoalProcessActions';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import UserAvatar from '@/features/User/UserAvatar';
import { goalSelectors, useGoalStore } from '@/store/goal';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import type { LifecycleNote } from './lifecycleEvent';
import { buildLifecycleDays, type LifecycleGroup, type LifecycleRow } from './lifecycleRows';

/**
 * The goal's history as a timeline, newest first and grouped by day. Each event
 * reads as one sentence — who, did what, to which node — with the node's kind
 * named in the verb ("创建任务 X", "得出结论 X") and marked by a gray kind glyph
 * for a quick scan — never coded in color. Only the leading glyph carries tone:
 * a resolve reads green, a reject red, everything else stays neutral, so the eye
 * can skim the outcomes.
 *
 * Which events share a line is decided in `lifecycleRows`: one line per
 * deliverable and one line per moment, so a settle that attached five artifacts
 * reads as one event with five cards instead of five identical sentences.
 */

const BADGE = 20;
/** The metric panel body's padding (`Body`), which is also the scroller's. */
const PANEL_PADDING = 16;
/** How much closer to the panel title a stuck day label sits than at rest. */
const STUCK_LIFT = 12;

const styles = createStaticStyles(({ css }) => ({
  artifact: css`
    margin: 0;
    padding-block: 8px;
    padding-inline: 10px;
    border: none;
    border-radius: ${cssVar.borderRadius};

    font: inherit;
    color: ${cssVar.colorText};
    text-align: start;

    background: ${cssVar.colorFillTertiary};
  `,
  artifactIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border-radius: ${cssVar.borderRadiusSM};

    background: ${cssVar.colorFillTertiary};
  `,
  artifactOpenable: css`
    cursor: pointer;

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
    }
  `,
  badge: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: ${BADGE}px;
    height: ${BADGE}px;
    border-radius: 50%;
  `,
  // Sticks past the panel's top edge instead of at the scroller's padding edge,
  // so rows scrolling by never show through a gap above it, and a stuck label
  // sits close under the panel title rather than a full padding below it. The
  // negative margin cancels the extra padding, leaving the resting layout as is.
  // Each day's header is bounded by its own group, so the next day pushes it out.
  day: css`
    position: sticky;
    z-index: 1;
    inset-block-start: -${PANEL_PADDING + STUCK_LIFT}px;

    margin-block-start: -${PANEL_PADDING}px;
    padding-block: ${PANEL_PADDING + 6}px 6px;

    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorBgContainer};
  `,
  item: css`
    position: relative;
    padding-block-end: 14px;

    /* The next day's header reaches ${PANEL_PADDING}px up above it; the last
       row leaves that much room so a card's bottom edge is never covered. */
    &:last-child {
      padding-block-end: ${PANEL_PADDING}px;
    }

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
    white-space: pre-line;

    background: ${cssVar.colorFillQuaternary};
  `,
  subject: css`
    cursor: pointer;

    overflow: hidden;
    display: inline-flex;
    gap: 6px;
    align-items: center;

    min-width: 0;
    margin: 0;
    padding-block: 1px;
    padding-inline: 6px;
    border: none;
    border-radius: ${cssVar.borderRadiusSM};

    font: inherit;
    color: ${cssVar.colorText};
    text-align: start;

    background: none;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
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

const ACTION_ICON: Record<string, LucideIcon> = {
  paused: Pause,
  resumed: Play,
  taskCanceled: Ban,
  work: PackageCheck,
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
    // A real button, so the node is reachable by Tab and opens on Enter / Space.
    <button className={styles.subject} type={'button'} onClick={() => onSelect(view.node.id)}>
      <Icon color={cssVar.colorTextTertiary} icon={KIND_ICON[view.node.kind]} size={13} />
      <span className={styles.subjectTitle}>{view.node.title}</span>
    </button>
  ),
);

Subject.displayName = 'GoalMetricLifecycleSubject';

const parseUrl = (url: string | null) => {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

/**
 * The glyph and caption a deliverable card leads with. A GitHub link is named
 * by its own glyph — a pull request as a PR — so its host would only repeat
 * what the icon already says; any other external link keeps its host.
 */
const artifactLook = (artifact: GoalArtifactView) => {
  const url = artifact.type === 'document' ? null : parseUrl(artifact.url);
  if (url?.hostname === 'github.com')
    return {
      host: null,
      icon: /\/pull\/\d+/.test(url.pathname) ? GitPullRequest : GithubIcon,
    };
  return { host: url?.host ?? null, icon: artifactIconOf(artifact.type) };
};

/**
 * A deliverable the event attached, as a card on its own line: the row names
 * the task that produced it, the card is the thing itself, opened where it
 * lives.
 */
const ArtifactCard = memo<{ artifact: GoalArtifactView }>(({ artifact }) => {
  const { t } = useTranslation('chat');
  const open = useOpenGoalArtifact();
  const openable = !!openTargetOf(artifact);
  const label = artifact.title || artifact.identifier || t('goalProcess.deliverables.untitled');
  const { host, icon } = artifactLook(artifact);

  return (
    <Flexbox
      horizontal
      align={'center'}
      as={openable ? 'button' : 'div'}
      className={cx(styles.artifact, openable && styles.artifactOpenable)}
      gap={10}
      {...(openable ? { onClick: () => open(artifact), type: 'button' as const } : {})}
    >
      <span className={styles.artifactIcon}>
        <Icon color={cssVar.colorTextSecondary} icon={icon} size={16} />
      </span>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text ellipsis fontSize={13} weight={500}>
          {label}
        </Text>
        {host && (
          <Text ellipsis fontSize={12} type={'secondary'}>
            {host}
          </Text>
        )}
      </Flexbox>
      {openable && <Icon color={cssVar.colorTextQuaternary} icon={ArrowUpRight} size={14} />}
    </Flexbox>
  );
});

ArtifactCard.displayName = 'GoalMetricLifecycleArtifact';

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

const UserActor = memo<{ userId?: string | null }>(({ userId }) => {
  const { t } = useTranslation('chat');
  const [currentUserId, nickName] = useUserStore((s) => [
    userProfileSelectors.userId(s),
    userProfileSelectors.nickName(s),
  ]);

  // Only the signed-in user can be shown by face; another member's event reads
  // as "Member" rather than borrowing this user's identity or calling it "You".
  if (userId && userId !== currentUserId)
    return (
      <Text fontSize={13} style={{ flex: 'none' }} weight={500}>
        {t('goalProcess.actor.member')}
      </Text>
    );

  return (
    <Flexbox horizontal align={'center'} flex={'none'} gap={6}>
      <UserAvatar size={16} />
      <Text ellipsis fontSize={13} style={{ maxWidth: 120 }} weight={500}>
        {nickName || t('goalProcess.actor.user')}
      </Text>
    </Flexbox>
  );
});

UserActor.displayName = 'GoalMetricLifecycleUserActor';

const Actor = memo<{ event: GoalGraphEvent }>(({ event }) => {
  const { t } = useTranslation('chat');
  if (event.actorType === 'agent' && event.actorId) return <AgentActor agentId={event.actorId} />;
  if (event.actorType === 'user') return <UserActor userId={event.actorId} />;

  // Automatic steps name no actor: the event reads as the action alone, so
  // the rows a person or agent drove stand out.
  if (event.actorType === 'system') return null;

  return (
    <Text fontSize={13} style={{ flex: 'none' }} weight={500}>
      {t('goalProcess.actor.agent')}
    </Text>
  );
});

Actor.displayName = 'GoalMetricLifecycleActor';

const noteText = (note: LifecycleNote, t: (key: any, options?: any) => string) => {
  if (!('key' in note)) return note.text;
  if (note.key === 'mainAgent')
    return t('goalProcess.lifecycle.note.mainAgent', { text: note.text });
  return t(`goalProcess.lifecycle.note.${note.key}` as const);
};

const EventItem = memo<{
  graph: GoalGraphView;
  group: LifecycleGroup;
  onSelect: (nodeId: string) => void;
}>(({ graph, group, onSelect }) => {
  const { t } = useTranslation('chat');
  const { event, presentation } = group.rows[0] as LifecycleRow;
  const visual = EVENT_VISUAL[event.eventType] ?? { icon: History, tone: NEUTRAL };
  const tone = visual.tone;
  // A recognised event names what happened more precisely than its raw type:
  // a canceled task or a delivered Work is not an "edit".
  const icon =
    (presentation.action && ACTION_ICON[presentation.action.split('.')[0]]) || visual.icon;
  const subjects = subjectNodes(event, graph);
  const kind = eventKind(event, subjects);
  const phrase = `${event.eventType}.${kind}`;
  const action = presentation.action
    ? t(`goalProcess.lifecycle.action.${presentation.action}` as const)
    : ACTION_PHRASES.has(phrase)
      ? t(`goalProcess.lifecycle.action.${phrase}` as any)
      : t(`goalProcess.lifecycle.action.${event.eventType}` as const, {
          kind: kind ? t(`goalProcess.lifecycle.kind.${kind}` as const) : '',
        }).trim();
  // One row can carry several deliverables: a settle attaches each of them, and
  // the fold in `buildLifecycleDays` merged them back into the moment they were
  // attached in. The row names the task, each card is one thing it delivered.
  const artifacts = group.rows.flatMap((row) => {
    const version = row.presentation.workVersion;
    if (!version) return [];
    const artifact = graph.artifacts.find((item) => item.workVersionId === version.id);
    return artifact ? [artifact] : [];
  });
  const note = presentation.note ? noteText(presentation.note, t) : undefined;

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
        {artifacts.map((artifact) => (
          <ArtifactCard artifact={artifact} key={artifact.workVersionId} />
        ))}
        {note && (
          <div className={styles.reason} title={note}>
            {note}
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
    const workTypes = new Map(
      (snapshot?.workVersions ?? []).map((link) => [link.workVersionId, link.work?.type]),
    );
    const workIds = new Map(
      (snapshot?.workVersions ?? []).map((link) => [link.workVersionId, link.work?.workId]),
    );
    return buildLifecycleDays(snapshot?.events ?? [], {
      workIdOf: (id) => workIds.get(id),
      workTypeOf: (id) => workTypes.get(id),
    });
  }, [snapshot]);

  if (days.length === 0)
    return <Empty description={t('goalProcess.metricDetail.lifecycle.empty')} icon={History} />;

  return (
    <Flexbox gap={0}>
      {days.map(({ day, groups }) => (
        <Flexbox gap={2} key={day.valueOf()}>
          <div className={styles.day}>{dayLabel(day)}</div>
          <Flexbox gap={0}>
            {groups.map((group) => (
              <EventItem
                graph={graph}
                group={group}
                key={group.rows[0].event.id}
                onSelect={onSelect}
              />
            ))}
          </Flexbox>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

Lifecycle.displayName = 'GoalMetricLifecycle';

export default Lifecycle;

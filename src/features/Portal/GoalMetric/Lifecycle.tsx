import type { GoalEventType, GoalGraphEvent, GoalNodeKind } from '@lobechat/types';
import { cssVar as cssVarValue, Empty, Flexbox, Icon, Text } from '@lobehub/ui';
import { GithubIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

import {
  artifactIconOf,
  openTargetOf,
  useOpenGoalArtifact,
} from '@/features/AgentGoals/ProcessControl/Deliverables';
import { AgentActor, UserActor } from '@/features/AgentGoals/ProcessControl/GoalActors';
import type {
  GoalArtifactView,
  GoalGraphView,
  GoalNodeView,
} from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';
import { KIND_ICON } from '@/features/AgentGoals/ProcessControl/shared';
import { useGoalNodeSelect } from '@/features/AgentGoals/ProcessControl/useGoalProcessActions';
import { goalSelectors, useGoalStore } from '@/store/goal';
import { sx } from '@/styles/sx';

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

const styles = stylex.create({
  artifact: {
    margin: 0,
    paddingBlock: '8px',
    paddingInline: '10px',
    borderStyle: 'none',
    borderRadius: cssVar.borderRadius,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontStyle: 'inherit',
    fontWeight: 'inherit',
    lineHeight: 'inherit',
    color: cssVar.colorText,
    textAlign: 'start',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  artifactIcon: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: cssVar.borderRadiusSM,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  artifactOpenable: {
    cursor: 'pointer',
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillSecondary },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '1px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
  },
  badge: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${BADGE}px`,
    height: `${BADGE}px`,
    borderRadius: '50%',
  },
  // Sticks past the panel's top edge instead of at the scroller's padding edge,
  // so rows scrolling by never show through a gap above it, and a stuck label
  // sits close under the panel title rather than a full padding below it. The
  // negative margin cancels the extra padding, leaving the resting layout as is.
  // Each day's header is bounded by its own group, so the next day pushes it out.
  day: {
    position: 'sticky',
    zIndex: 1,
    insetBlockStart: `-${PANEL_PADDING + STUCK_LIFT}px`,
    marginBlockStart: `-${PANEL_PADDING}px`,
    paddingBlockStart: `${PANEL_PADDING + 6}px`,
    paddingBlockEnd: '6px',
    fontSize: '12px',
    fontWeight: 600,
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  dayPlain: {
    paddingBlockStart: '12px',
    paddingBlockEnd: '6px',
    fontSize: '12px',
    fontWeight: 600,
    color: cssVar.colorTextTertiary,
  },
  item: { position: 'relative', paddingBlockEnd: '14px' },
  // The next day's header reaches PANEL_PADDING up above it; the last row
  // leaves that much room so a card's bottom edge is never covered.
  itemLast: { paddingBlockEnd: `${PANEL_PADDING}px` },
  // The rail: runs from under this badge to the next one.
  itemRail: {
    '::before': {
      content: '""',
      position: 'absolute',
      insetBlockStart: `${BADGE + 4}px`,
      insetBlockEnd: '2px',
      insetInlineStart: `${BADGE / 2 - 0.5}px`,
      width: '1px',
      backgroundColor: cssVar.colorBorderSecondary,
      backgroundImage: 'none',
    },
  },
  mono: { fontFamily: cssVar.fontFamilyCode, fontVariantNumeric: 'tabular-nums' },
  reason: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 3,
    paddingBlock: '6px',
    paddingInline: '10px',
    borderRadius: cssVar.borderRadius,
    fontSize: '12px',
    lineHeight: 1.6,
    color: cssVar.colorTextSecondary,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-line',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  subject: {
    cursor: 'pointer',
    overflow: 'hidden',
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    minWidth: 0,
    margin: 0,
    paddingBlock: '1px',
    paddingInline: '6px',
    borderStyle: 'none',
    borderRadius: cssVar.borderRadiusSM,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontStyle: 'inherit',
    fontWeight: 'inherit',
    lineHeight: 'inherit',
    color: cssVar.colorText,
    textAlign: 'start',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '1px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
  },
  subjectTitle: {
    overflow: 'hidden',
    fontSize: '13px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

interface Tone {
  bg: string;
  fg: string;
}

const NEUTRAL: Tone = { bg: cssVarValue.colorFillTertiary, fg: cssVarValue.colorTextSecondary };

const EVENT_VISUAL: Record<GoalEventType, { icon: LucideIcon; tone: Tone }> = {
  // Starting an attempt is progress, not an outcome — it stays neutral so only
  // resolve / reject carry color.
  activated: { icon: Play, tone: NEUTRAL },
  created: { icon: Plus, tone: NEUTRAL },
  linked: { icon: Link2, tone: NEUTRAL },
  rejected: { icon: X, tone: { bg: cssVarValue.colorErrorBg, fg: cssVarValue.colorError } },
  resolved: { icon: Check, tone: { bg: cssVarValue.colorSuccessBg, fg: cssVarValue.colorSuccess } },
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
    <button
      {...stylex.props(styles.subject)}
      type={'button'}
      onClick={() => onSelect(view.node.id)}
    >
      <Icon color={cssVarValue.colorTextTertiary} icon={KIND_ICON[view.node.kind]} size={13} />
      <span {...stylex.props(styles.subjectTitle)}>{view.node.title}</span>
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
      className={stylex.props(styles.artifact, openable && styles.artifactOpenable).className}
      gap={10}
      {...(openable ? { onClick: () => open(artifact), type: 'button' as const } : {})}
    >
      <span {...stylex.props(styles.artifactIcon)}>
        <Icon color={cssVarValue.colorTextSecondary} icon={icon} size={16} />
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
      {openable && <Icon color={cssVarValue.colorTextQuaternary} icon={ArrowUpRight} size={14} />}
    </Flexbox>
  );
});

ArtifactCard.displayName = 'GoalMetricLifecycleArtifact';

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
  /** The day's last event: leaves room for the next day's header, and ends the rail. */
  last: boolean;
  onSelect: (nodeId: string) => void;
}>(({ graph, group, last, onSelect }) => {
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
    <Flexbox
      horizontal
      className={stylex.props(styles.item, last ? styles.itemLast : styles.itemRail).className}
      gap={10}
    >
      <span {...sx(styles.badge, undefined, { background: tone.bg })}>
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
            className={stylex.props(styles.mono).className}
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
          <div {...stylex.props(styles.reason)} title={note}>
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

interface LifecycleProps {
  goalId: string;
  graph: GoalGraphView;
  /**
   * Click landing for a row's subject. A host that also renders the graph passes
   * its own handler so a timeline click keeps the map's selection in sync —
   * without it the timeline would open the node but leave the graph stale.
   */
  onSelect?: (nodeId: string) => void;
  /**
   * Pins each day label under the host's top edge. Only right inside the metric
   * panel, whose padded scroller the offsets are computed against; a host that
   * scrolls the page turns it off.
   */
  stickyDays?: boolean;
}

const Lifecycle = memo<LifecycleProps>(({ goalId, graph, stickyDays = true, onSelect }) => {
  const { t } = useTranslation('chat');
  const dayLabel = useDayLabel();
  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));
  // Same landing as a click anywhere else on the goal: a Task opens its Task
  // panel, other nodes their drill-down. A host that owns the graph's selection
  // passes its own handler instead, so the click updates both surfaces.
  const openNode = useGoalNodeSelect(goalId, graph);
  const select = onSelect ?? openNode;

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
          <div {...stylex.props(stickyDays ? styles.day : styles.dayPlain)}>{dayLabel(day)}</div>
          <Flexbox gap={0}>
            {groups.map((group, index) => (
              <EventItem
                graph={graph}
                group={group}
                key={group.rows[0].event.id}
                last={index === groups.length - 1}
                onSelect={select}
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

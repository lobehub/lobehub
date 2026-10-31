'use client';

import { Empty, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BotMessageSquare, ChevronRight } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActivityTime } from '@/hooks/useActivityTime';

import { coordinatorNodeTitleKey } from './coordinatorCopy';
import type { GoalGraphView, GoalNodeView } from './goalGraphViewModel';
import { KindDot } from './shared';
import { useElapsed } from './useElapsed';

/**
 * 活动 — one row per node, not a raw event dump.
 *
 * A goal produces many runtime events (dispatch, evidence submission, verifier
 * verdicts, lease renewals). Most of them belong *inside* a task: the verifier
 * judging attempt #2 is part of that task's story, not a separate line in the
 * goal's history. So each row is "what this task did, how it ended", with the
 * per-attempt ledger folded underneath.
 */

const styles = stylex.create({
  arrow: { flex: 'none', color: cssVar.colorTextQuaternary, transition: 'transform 0.2s' },
  arrowOpen: { transform: 'rotate(90deg)' },
  attempt: {
    paddingBlock: '6px',
    borderBlockStartWidth: { default: null, [stylex.when.siblingBefore(':is(*)')]: '1px' },
    borderBlockStartStyle: { default: null, [stylex.when.siblingBefore(':is(*)')]: 'dashed' },
    borderBlockStartColor: {
      default: null,
      [stylex.when.siblingBefore(':is(*)')]: cssVar.colorBorderSecondary,
    },
  },
  body: {
    paddingBlockStart: '0',
    paddingBlockEnd: '10px',
    paddingInlineStart: '42px',
    paddingInlineEnd: '9px',
  },
  mono: { fontFamily: cssVar.fontFamilyCode, fontVariantNumeric: 'tabular-nums' },
  // The hover wash keeps its inset; the row's content lines up with the section title.
  row: {
    cursor: 'pointer',
    marginInline: '-9px',
    paddingBlock: '6px',
    paddingInline: '9px',
    borderRadius: cssVar.borderRadiusSM,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  time: { flex: 'none', marginInlineStart: 'auto' },
});

const lastTouch = (view: GoalNodeView): Date =>
  [
    view.node.resolvedAt,
    view.node.updatedAt,
    view.attempts.at(-1)?.endedAt,
    view.attempts.at(-1)?.startedAt,
  ]
    .filter((date): date is Date => !!date)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? view.node.createdAt;

const useSummary = () => {
  const { t } = useTranslation('chat');
  return (view: GoalNodeView): string => {
    const { node } = view;
    const count = view.attempts.length;
    if (node.kind === 'decision')
      return node.status === 'waiting'
        ? t('goalProcess.summary.gateOpen')
        : t('goalProcess.summary.gateResolved', {
            option: view.humanTouches[0]?.resolvedOptionId ?? '—',
          });
    switch (node.status) {
      case 'active': {
        return t('goalProcess.summary.running', { index: count });
      }
      case 'rejected':
      case 'retired': {
        return t('goalProcess.summary.retired', { count });
      }
      case 'resolved': {
        return t('goalProcess.summary.done', { count });
      }
      case 'waiting': {
        return t('goalProcess.summary.waiting', { count });
      }
      default: {
        return t('goalProcess.summary.notStarted');
      }
    }
  };
};

const RunningClock = memo<{ startedAt?: Date }>(({ startedAt }) => {
  const { t } = useTranslation('chat');
  const elapsed = useElapsed(startedAt);
  if (!elapsed) return null;
  return (
    <Text
      className={stylex.props(styles.mono).className}
      fontSize={12}
      style={{ flex: 'none' }}
      type={'secondary'}
    >
      {t('goalProcess.running.elapsed', { duration: elapsed })}
    </Text>
  );
});

RunningClock.displayName = 'GoalActivityRunningClock';

const ActivityRow = memo<{ onSelect: (nodeId: string) => void; view: GoalNodeView }>(
  ({ onSelect, view }) => {
    const { t } = useTranslation('chat');
    const summarize = useSummary();
    const [open, setOpen] = useState(false);
    const { text, title } = useActivityTime(lastTouch(view));
    const hasDetail = view.attempts.length > 0 || view.findings.length > 0;
    const coordinatorTitleKey = coordinatorNodeTitleKey(view);

    return (
      <Flexbox gap={0}>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.row).className}
          gap={8}
          onClick={() => (hasDetail ? setOpen(!open) : onSelect(view.node.id))}
        >
          <Icon
            className={stylex.props(styles.arrow, open && styles.arrowOpen).className}
            icon={ChevronRight}
            size={14}
            style={{ opacity: hasDetail ? 1 : 0 }}
          />
          <KindDot kind={view.node.kind} />
          <Text ellipsis style={{ flexShrink: 1, minWidth: 0 }} weight={500}>
            {coordinatorTitleKey ? t(coordinatorTitleKey as any) : view.node.title}
          </Text>
          <Text ellipsis fontSize={14} style={{ flexShrink: 1, minWidth: 0 }} type={'secondary'}>
            {summarize(view)}
          </Text>
          {view.startedAt && <RunningClock startedAt={view.startedAt} />}
          <Text
            className={stylex.props(styles.time, styles.mono).className}
            fontSize={12}
            title={title}
            type={'secondary'}
          >
            {text}
          </Text>
        </Flexbox>
        {open && (
          <Flexbox className={stylex.props(styles.body).className} gap={10}>
            {view.attempts.length > 0 && (
              <Flexbox gap={0}>
                {view.attempts.map((attempt) => (
                  <Flexbox
                    className={stylex.props(styles.attempt, stylex.defaultMarker()).className}
                    gap={2}
                    key={attempt.index}
                  >
                    <Flexbox horizontal align={'center'} gap={8}>
                      <Text fontSize={12} style={{ flex: 'none' }} weight={600}>
                        {t('goalProcess.attempts.nth', { index: attempt.index })}
                      </Text>
                      <Text
                        fontSize={12}
                        style={{ flex: 'none' }}
                        type={
                          attempt.outcome === 'passed'
                            ? 'success'
                            : attempt.outcome === 'failed'
                              ? 'danger'
                              : 'secondary'
                        }
                      >
                        {t(`goalProcess.attempts.${attempt.outcome}` as const)}
                      </Text>
                    </Flexbox>
                    {attempt.reason && (
                      <Text fontSize={12} type={'secondary'}>
                        {attempt.reason}
                      </Text>
                    )}
                  </Flexbox>
                ))}
              </Flexbox>
            )}
            {view.findings.map((finding) => (
              <Flexbox
                horizontal
                align={'center'}
                gap={6}
                key={finding.id}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect(finding.id)}
              >
                <KindDot kind={'finding'} />
                <Text fontSize={13}>
                  {t('goalProcess.activity.finding', { title: finding.title })}
                </Text>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

ActivityRow.displayName = 'GoalActivityRow';

const Activity = memo<{ graph: GoalGraphView; onSelect: (nodeId: string) => void }>(
  ({ graph, onSelect }) => {
    const { t } = useTranslation('chat');
    const rows = graph.nodes
      .filter(
        (view) =>
          (view.node.kind === 'task' &&
            (view.attempts.length > 0 || view.node.status !== 'proposed')) ||
          (view.node.kind === 'decision' && view.node.status !== 'proposed'),
      )
      .sort((a, b) => lastTouch(b).getTime() - lastTouch(a).getTime());

    if (rows.length === 0)
      return <Empty description={t('goalProcess.activity.empty')} icon={BotMessageSquare} />;

    return (
      <Flexbox gap={2}>
        {rows.map((view) => (
          <ActivityRow key={view.node.id} view={view} onSelect={onSelect} />
        ))}
      </Flexbox>
    );
  },
);

Activity.displayName = 'GoalActivity';

export default Activity;

import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { CircleCheck, CircleDashed, CircleX } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { GoalGraphView } from '../goalGraphViewModel';
import { CELL_VISUAL } from '../Graph/BatchGroups';
import {
  type BatchGateState,
  type BatchModel,
  type BatchRound,
  verdictChecks,
} from '../Graph/batchModel';
import { KindDot } from '../shared';
import { type GateCheckLike, useGateCheckCopy } from './useGateCheckCopy';

/**
 * What a release gate actually decided, for the panel that opens on it.
 *
 * The gate is not a person's decision: the coordinator judges it on its own
 * each time a round's units settle. So the panel leads with the verdict and
 * what happens next, then the checks of the latest verdict with the units
 * behind any that failed, then every verdict this round took.
 */

const styles = createStaticStyles(({ css }) => ({
  check: css`
    padding-block: 6px;

    & + & {
      border-block-start: 1px dashed ${cssVar.colorBorderSecondary};
    }
  `,
  label: css`
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
  `,
  link: css`
    cursor: pointer;
    padding-block: 2px;
    padding-inline: 4px;
    border-radius: ${cssVar.borderRadiusSM};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-variant-numeric: tabular-nums;
  `,
}));

const GATE_VISUAL: Record<BatchGateState, (typeof CELL_VISUAL)[keyof typeof CELL_VISUAL]> = {
  checking: CELL_VISUAL.running,
  human: CELL_VISUAL.human,
  locked: CELL_VISUAL.backlog,
  passed: CELL_VISUAL.done,
  rejected: CELL_VISUAL.stale,
};

const Section = memo<{ children: ReactNode; extra?: ReactNode; title: string }>(
  ({ children, extra, title }) => (
    <Flexbox gap={6}>
      <Flexbox horizontal align={'baseline'} gap={8} justify={'space-between'}>
        <span className={styles.label}>{title}</span>
        {extra}
      </Flexbox>
      {children}
    </Flexbox>
  ),
);

Section.displayName = 'GoalGateDetailSection';

interface GateDetailProps {
  graph: GoalGraphView;
  model: BatchModel;
  onOpenNode: (nodeId: string) => void;
  round: BatchRound;
}

const GateDetail = memo<GateDetailProps>(({ graph, model, onOpenNode, round }) => {
  const { t } = useTranslation('chat');
  const copy = useGateCheckCopy();
  const visual = GATE_VISUAL[round.gate];
  const evaluations = round.evaluations;
  const latest = evaluations.at(-1);
  const lastRelease = evaluations.findLast((item) => item.outcome === 'released');
  const isCurrent = model.rounds.at(-1) === round;

  const next = (() => {
    switch (round.gate) {
      case 'locked': {
        return t('goalBatch.gatePanel.next.locked', { count: round.probes.length });
      }
      case 'checking': {
        return t('goalBatch.gatePanel.next.checking');
      }
      case 'human': {
        return t('goalBatch.gatePanel.next.human');
      }
      case 'rejected': {
        return t('goalBatch.gatePanel.next.rejected', { revision: round.revision + 1 });
      }
      default: {
        if (isCurrent && model.phase === 'done') return t('goalBatch.gatePanel.next.passedDone');
        return lastRelease
          ? t('goalBatch.gatePanel.next.passed', {
              count: lastRelease.releasedCount ?? 0,
              wave: lastRelease.wave ?? lastRelease.waveIndex,
            })
          : undefined;
      }
    }
  })();

  // A gate that visibly judged but left no record decided before verdicts were
  // kept — say so, rather than presenting it as never judged.
  const unrecorded = !latest && round.gate !== 'locked' && round.gate !== 'checking';
  // The latest verdict's checks, or — before any — the ones it will run.
  const checks: GateCheckLike[] = latest
    ? verdictChecks(latest)
    : unrecorded
      ? []
      : model.gateChecks;

  const nodeLink = (nodeId: string) => {
    const view = graph.byId[nodeId];
    if (!view) return null;
    return (
      <Flexbox
        horizontal
        align={'center'}
        className={styles.link}
        gap={6}
        key={nodeId}
        onClick={() => onOpenNode(nodeId)}
      >
        <KindDot kind={view.node.kind} />
        <Text ellipsis fontSize={12} type={'secondary'}>
          {view.node.title}
        </Text>
      </Flexbox>
    );
  };

  return (
    <Flexbox data-gate-detail gap={16}>
      <Section title={t('goalBatch.gatePanel.verdict')}>
        <Flexbox horizontal align={'center'} gap={6}>
          <Icon color={visual.color} icon={visual.icon} size={14} />
          <Text fontSize={13} style={{ color: visual.color }}>
            {t(`goalBatch.gate.status.${round.gate}` as const)}
          </Text>
        </Flexbox>
        {next && (
          <Text fontSize={13} type={'secondary'}>
            {next}
          </Text>
        )}
      </Section>

      <Section
        title={t('goalBatch.gatePanel.checks')}
        extra={
          <Text className={styles.mono} fontSize={11} type={'secondary'}>
            {latest
              ? latest.seq
                ? t('goalBatch.gatePanel.checksAt', {
                    index: latest.seq,
                    time: dayjs(latest.at).format('MM-DD HH:mm'),
                  })
                : dayjs(latest.at).format('MM-DD HH:mm')
              : unrecorded
                ? undefined
                : t('goalBatch.gatePanel.checksPlanned')}
          </Text>
        }
      >
        {unrecorded && (
          <Text fontSize={12} type={'secondary'}>
            {t('goalBatch.gatePanel.history.unrecorded')}
          </Text>
        )}
        <Flexbox gap={0}>
          {checks.map((check, index) => {
            const { detail, label } = copy(check);
            const state = check.passed === undefined ? 'planned' : check.passed ? 'pass' : 'fail';
            const icon = state === 'pass' ? CircleCheck : state === 'fail' ? CircleX : CircleDashed;
            const color =
              state === 'pass'
                ? CELL_VISUAL.done.color
                : state === 'fail'
                  ? cssVar.colorError
                  : cssVar.colorTextQuaternary;
            return (
              <Flexbox
                className={styles.check}
                data-check={check.key}
                data-state={state}
                gap={4}
                key={index}
              >
                <Flexbox horizontal align={'center'} gap={8}>
                  <Icon color={color} icon={icon} size={14} />
                  <Text fontSize={13} style={{ flex: 1, minWidth: 0 }}>
                    {label}
                  </Text>
                  {detail && (
                    <Text className={styles.mono} fontSize={12} type={'secondary'}>
                      {detail}
                    </Text>
                  )}
                </Flexbox>
                {!check.passed && check.nodeIds?.length ? (
                  <Flexbox gap={2} paddingInline={'22px 0'}>
                    {check.nodeIds.map(nodeLink)}
                  </Flexbox>
                ) : null}
              </Flexbox>
            );
          })}
        </Flexbox>
      </Section>

      {/* An unrecorded gate already said so under its checks. */}
      {!unrecorded && (
        <Section title={t('goalBatch.gatePanel.history')}>
          {evaluations.length === 0 ? (
            <Text fontSize={12} type={'secondary'}>
              {t('goalBatch.gatePanel.history.empty')}
            </Text>
          ) : (
            <Flexbox gap={6}>
              {[...evaluations].reverse().map((evaluation) => {
                const failed = verdictChecks(evaluation)
                  .filter((check) => !check.passed)
                  .map((check) => copy(check).label);
                const text =
                  evaluation.outcome === 'released'
                    ? t('goalBatch.gatePanel.history.released', {
                        count: evaluation.releasedCount ?? 0,
                        wave: evaluation.wave ?? evaluation.waveIndex,
                      })
                    : evaluation.trigger === 'unit'
                      ? t('goalBatch.gatePanel.history.unit', {
                          title: graph.byId[evaluation.nodeId ?? '']?.node.title ?? '',
                        })
                      : t('goalBatch.gatePanel.history.blocked', { checks: failed.join('；') });
                const passed = evaluation.outcome === 'released';
                return (
                  <Flexbox horizontal align={'baseline'} gap={10} key={evaluation.at}>
                    <Text
                      className={styles.mono}
                      fontSize={12}
                      style={{ flex: 'none' }}
                      type={'secondary'}
                    >
                      {dayjs(evaluation.at).format('MM-DD HH:mm')}
                    </Text>
                    <Icon
                      color={passed ? CELL_VISUAL.done.color : cssVar.colorError}
                      icon={passed ? CircleCheck : CircleX}
                      size={12}
                    />
                    <Text fontSize={12} style={{ flex: 1, minWidth: 0 }}>
                      {text}
                    </Text>
                  </Flexbox>
                );
              })}
            </Flexbox>
          )}
        </Section>
      )}
    </Flexbox>
  );
});

GateDetail.displayName = 'GoalBatchGateDetail';

export default GateDetail;

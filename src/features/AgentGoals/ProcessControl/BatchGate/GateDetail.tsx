import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { CircleCheck, CircleDashed, CircleX, GraduationCap } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import GoalDecisionCase from '../../GoalDecision';
import type { GoalGraphView } from '../goalGraphViewModel';
import { CELL_VISUAL } from '../Graph/BatchGroups';
import {
  batchCellState,
  type BatchGateState,
  type BatchModel,
  type BatchRound,
  verdictChecks,
} from '../Graph/batchModel';
import { KIND_COLOR, KIND_ICON } from '../shared';
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
  /* A unit behind a failed check, as the card it is on the map — not a line of text. */
  unitCard: css`
    cursor: pointer;

    padding-block: 8px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    transition: border-color 0.15s;

    &:hover {
      border-color: ${cssVar.colorBorder};
    }
  `,
  unitGlyph: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 26px;
    height: 26px;
    border-radius: 6px;
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
  /** Answer the gate's open decision; absent where the reader cannot answer. */
  decide?: (decisionId: string, optionId: string, resolution?: string) => Promise<unknown>;
  graph: GoalGraphView;
  model: BatchModel;
  onOpenNode: (nodeId: string) => void;
  round: BatchRound;
}

const GateDetail = memo<GateDetailProps>(({ decide, graph, model, onOpenNode, round }) => {
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

  const superseded = new Set(
    graph.edges.filter((edge) => edge.kind === 'derived_from').map((edge) => edge.targetNodeId),
  );
  const unitCard = (nodeId: string) => {
    const view = graph.byId[nodeId];
    if (!view) return null;
    const kind = view.node.kind === 'decision' ? 'decision' : 'task';
    // Same reading as the squares: a unit a later round re-opened is superseded.
    const state = superseded.has(nodeId) ? 'stale' : batchCellState(view, new Set());
    const status = CELL_VISUAL[state];
    return (
      <Flexbox
        horizontal
        align={'center'}
        className={styles.unitCard}
        data-unit={nodeId}
        gap={8}
        key={nodeId}
        role={'button'}
        onClick={() => onOpenNode(nodeId)}
      >
        <span
          className={styles.unitGlyph}
          style={{ background: KIND_COLOR[kind].soft, color: KIND_COLOR[kind].line }}
        >
          <Icon icon={KIND_ICON[kind]} size={14} />
        </span>
        <Text ellipsis fontSize={13} style={{ flex: 1, minWidth: 0 }} weight={500}>
          {view.node.title}
        </Text>
        {kind === 'task' && (
          <Flexbox horizontal align={'center'} gap={4} style={{ flex: 'none' }}>
            <Icon color={status.color} icon={status.icon} size={13} />
            <Text fontSize={12} style={{ color: status.color }}>
              {t(`goalBatch.cell.${state}` as const)}
            </Text>
          </Flexbox>
        )}
      </Flexbox>
    );
  };

  const learned = model.learnings.filter((learning) => learning.revision === round.revision);

  // The gate is waiting on a person: answer it here, beside what it found.
  const pending = round.assayId ? graph.byId[round.assayId]?.decision : undefined;

  return (
    <Flexbox data-gate-detail gap={16}>
      {/* Waiting on a person, the question itself leads: no verdict line and no
          section label repeating "needs your decision" above it. */}
      {pending && decide ? (
        <GoalDecisionCase
          hideAsker
          category={'judgment'}
          decision={{ ...pending, question: t('goalBatch.gatePanel.question') }}
          onDecide={(optionId, resolution) => decide(pending.id, optionId, resolution)}
        />
      ) : (
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
      )}

      {/* What this gate's break taught the batch: a rule the executor reads,
          compiled into an acceptance check later units are verified against. */}
      {learned.length > 0 && (
        <Section title={t('goalBatch.gatePanel.learned')}>
          <Flexbox data-gate-learned gap={6}>
            {learned.map((learning) => (
              <Flexbox horizontal align={'baseline'} gap={8} key={learning.lessonId}>
                <Icon color={cssVar.colorTextSecondary} icon={GraduationCap} size={13} />
                <Text fontSize={13} style={{ flex: 1, minWidth: 0 }}>
                  {learning.title}
                </Text>
                {learning.lessonCode && (
                  <Text className={styles.mono} fontSize={12} type={'secondary'}>
                    {learning.lessonCode}
                  </Text>
                )}
              </Flexbox>
            ))}
            <Text fontSize={12} type={'secondary'}>
              {t('goalBatch.gatePanel.learnedHint')}
            </Text>
          </Flexbox>
        </Section>
      )}

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
                  <Flexbox gap={6} paddingInline={'22px 0'}>
                    {check.nodeIds.map(unitCard)}
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
                    <Icon
                      color={passed ? CELL_VISUAL.done.color : cssVar.colorError}
                      icon={passed ? CircleCheck : CircleX}
                      size={12}
                    />
                    <Text fontSize={12} style={{ flex: 1, minWidth: 0 }}>
                      {text}
                    </Text>
                    <Text
                      className={styles.mono}
                      fontSize={12}
                      style={{ flex: 'none' }}
                      type={'secondary'}
                    >
                      {dayjs(evaluation.at).format('MM-DD HH:mm')}
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

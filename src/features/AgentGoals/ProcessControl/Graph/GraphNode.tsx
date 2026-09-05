'use client';

import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { FileBox, type LucideIcon, Repeat2, ShieldCheck } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';
import RunningGlyph from '@/features/Home/components/RunningGlyph';
import { shinyTextStyles } from '@/styles';

import { coordinatorNodeTitleKey } from '../coordinatorCopy';
import type { GoalNodeView } from '../goalGraphViewModel';
import { KIND_COLOR, KIND_ICON } from '../shared';
import { useElapsed } from '../useElapsed';

/**
 * A graph card: leading kind icon on a tinted square, title plus a one-line
 * subtitle, a state chip on the top edge, and — for a task — a metric strip
 * (attempts · verifier · artifacts · running clock) so the map answers "who is
 * on it, has it been checked, did it produce anything" without opening a node.
 */

export interface GraphNodeData extends Record<string, unknown> {
  dim: boolean;
  isGate: boolean;
  running: boolean;
  selected: boolean;
  stale: boolean;
  subtitle: string;
  view: GoalNodeView;
}

const styles = createStaticStyles(({ css }) => ({
  card: css`
    box-sizing: border-box;
    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    transition:
      opacity 0.2s,
      border-color 0.15s;
  `,
  chipText: css`
    font-size: 11px;
    line-height: 16px;
    white-space: nowrap;
  `,
  dim: css`
    opacity: 0.45;
  `,
  statusRow: css`
    display: flex;
    gap: 10px;
    align-items: center;

    padding-block: 10px 0;
    padding-inline: 12px;

    font-family: ${cssVar.fontFamilyCode};
    font-variant-numeric: tabular-nums;

    /* The row owns the card's top padding; keep the head snug beneath it. */
    & + div {
      padding-block-start: 6px;
    }
  `,
  gate: css`
    border-color: ${cssVar.colorWarningBorder};
    background: ${cssVar.colorWarningBg};
  `,
  ghost: css`
    border-style: dashed;
  `,
  ghostBar: css`
    height: 8px;
    border-radius: 4px;
    background: ${cssVar.colorFillSecondary};
    animation: goal-ghost-pulse 1.6s ease-in-out infinite;

    @keyframes goal-ghost-pulse {
      0%,
      100% {
        opacity: 1;
      }

      50% {
        opacity: 0.4;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
  glyph: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 30px;
    height: 30px;
    border-radius: ${cssVar.borderRadius};
  `,
  handle: css`
    width: 1px;
    min-width: 0;
    height: 1px;
    min-height: 0;
    border: none;

    opacity: 0;
  `,
  head: css`
    display: flex;
    gap: 10px;
    align-items: flex-start;

    padding-block: 10px;
    padding-inline: 12px;
  `,
  human: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 16px;
    height: 16px;
    border-radius: 50%;

    font-size: 9px;
    font-weight: 600;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillTertiary};
  `,
  metric: css`
    display: flex;
    gap: 4px;
    align-items: center;
  `,
  metrics: css`
    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 12px;
    border-block-start: 1px dashed ${cssVar.colorBorderSecondary};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  selected: css`
    border-color: ${cssVar.colorPrimaryBorder};
  `,
  stale: css`
    border-color: ${cssVar.colorErrorBorder};
  `,
  subtitle: css`
    overflow: hidden;

    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  title: css`
    font-size: 13px;
    font-weight: 500;
    line-height: 1.35;
  `,
}));

interface StateChip {
  color: string;
  /** The task family's status glyph; running renders the animated ring instead. */
  icon?: LucideIcon;
  text: string;
}

const useStateChip = (data: GraphNodeData): StateChip | null => {
  const { t } = useTranslation('chat');
  const { isGate, running, stale, view } = data;
  const { node } = view;

  if (isGate)
    return {
      color: TASK_STATUS_VISUALS.paused.color,
      icon: TASK_STATUS_VISUALS.paused.icon,
      text: t('goalProcess.tag.needsDecision'),
    };
  if (stale)
    return {
      color: TASK_STATUS_VISUALS.failed.color,
      icon: TASK_STATUS_VISUALS.failed.icon,
      text: t('goalProcess.tag.lost'),
    };
  // Running renders the same animated ring the frontier and home surfaces use.
  if (running)
    return { color: TASK_STATUS_VISUALS.running.color, text: t('goalProcess.node.running') };
  if (node.kind === 'task' && node.status === 'resolved')
    return {
      color: TASK_STATUS_VISUALS.completed.color,
      icon: TASK_STATUS_VISUALS.completed.icon,
      text: t('goalProcess.node.done'),
    };
  if (node.kind === 'task' && (node.status === 'retired' || node.status === 'rejected'))
    return {
      color: TASK_STATUS_VISUALS.canceled.color,
      icon: TASK_STATUS_VISUALS.canceled.icon,
      text: t('goalProcess.tag.retired'),
    };
  if (node.kind === 'decision' && node.status === 'resolved')
    return {
      color: cssVar.colorTextTertiary,
      icon: TASK_STATUS_VISUALS.completed.icon,
      text: view.humanTouches.length
        ? t('goalProcess.node.decidedByYou')
        : t('goalProcess.node.decidedByAgent'),
    };
  // Every task reads its state in the same top row — a queued one included,
  // so "not dispatched" no longer hides in the metric strip.
  if (node.kind === 'task')
    return {
      color: TASK_STATUS_VISUALS.backlog.color,
      icon: TASK_STATUS_VISUALS.backlog.icon,
      text: node.taskId
        ? t(`goalProcess.nodeStatus.${node.status}` as const)
        : t('goalProcess.node.unassigned'),
    };
  return null;
};

const RunningClock = memo<{ startedAt?: Date }>(({ startedAt }) => {
  const elapsed = useElapsed(startedAt);
  if (!elapsed) return null;
  // Sits right behind the state chip in the status row — no auto margin. The
  // clock is ambient context, so it reads in a light tint, not body color.
  return <span style={{ color: cssVar.colorTextTertiary, fontSize: 11 }}>{elapsed}</span>;
});

RunningClock.displayName = 'GoalGraphRunningClock';

const GraphNodeView = memo<NodeProps>(({ data }) => {
  const { t } = useTranslation('chat');
  const nodeData = data as GraphNodeData;
  const { dim, isGate, running, selected, stale, subtitle, view } = nodeData;
  const { node } = view;
  const chip = useStateChip(nodeData);
  const palette = KIND_COLOR[node.kind];
  const isTask = node.kind === 'task';
  const attempts = view.attempts.length;
  // Coordinator-authored node titles are English; recognized ones localize.
  const coordinatorTitleKey = coordinatorNodeTitleKey(view);

  return (
    <div style={{ position: 'relative' }}>
      <Handle
        className={styles.handle}
        isConnectable={false}
        position={Position.Top}
        type={'target'}
      />
      <div
        className={cx(
          styles.card,
          isGate && styles.gate,
          stale && styles.stale,
          dim && styles.dim,
          selected && styles.selected,
        )}
      >
        {/* Status reads first: its own top row, left-aligned, with the running
            clock riding right behind it (review: bottom placements read poorly). */}
        {(chip || view.humanTouches.length > 0) && (
          <div className={styles.statusRow}>
            {chip && (
              <Flexbox horizontal align={'center'} gap={5}>
                {chip.icon ? (
                  <Icon color={chip.color} icon={chip.icon} size={13} />
                ) : (
                  <RunningGlyph size={13} />
                )}
                <span className={styles.chipText} style={{ color: chip.color }}>
                  {chip.text}
                </span>
              </Flexbox>
            )}
            {running && <RunningClock startedAt={view.startedAt} />}
            {view.humanTouches.length > 0 && (
              <Tooltip title={t('goalProcess.node.humanTouched')}>
                <span className={styles.human}>@</span>
              </Tooltip>
            )}
            {/* Top-right corner: this Task carries its own verifier. Icon only —
                the word added nothing the hover hint doesn't say better. */}
            {isTask && node.taskId && (
              <Tooltip title={t('goalProcess.node.verifierTooltip')}>
                <span style={{ display: 'inline-flex', marginInlineStart: 'auto' }}>
                  <Icon color={cssVar.colorTextTertiary} icon={ShieldCheck} size={13} />
                </span>
              </Tooltip>
            )}
          </div>
        )}
        <div className={styles.head}>
          <div className={styles.glyph} style={{ background: palette.soft, color: palette.line }}>
            <Icon icon={KIND_ICON[node.kind]} size={16} />
          </div>
          <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
            <span className={styles.title}>
              {coordinatorTitleKey ? t(coordinatorTitleKey as any) : node.title}
            </span>
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          </Flexbox>
        </div>
        {isTask && (
          <div className={styles.metrics}>
            <Tooltip title={t('goalProcess.node.attemptsTooltip', { count: attempts })}>
              <span className={styles.metric}>
                <Icon icon={Repeat2} size={13} />
                {attempts}
              </span>
            </Tooltip>
            {view.artifacts.length > 0 && (
              <Tooltip
                title={t('goalProcess.node.artifactsTooltip', { count: view.artifacts.length })}
              >
                <span className={styles.metric}>
                  <Icon icon={FileBox} size={13} />
                  {view.artifacts.length}
                </span>
              </Tooltip>
            )}
          </div>
        )}
      </div>
      <Handle
        className={styles.handle}
        isConnectable={false}
        position={Position.Bottom}
        type={'source'}
      />
    </div>
  );
});

GraphNodeView.displayName = 'GoalGraphNodeView';

/**
 * A placeholder card shown while the coordinator is still decomposing the goal:
 * same silhouette as a task node, dashed and pulsing, so the map promises the
 * structure that is about to arrive instead of sitting empty.
 */
export const GhostNodeView = memo(() => {
  const { t } = useTranslation('chat');
  return (
    <div style={{ position: 'relative' }}>
      <Handle
        className={styles.handle}
        isConnectable={false}
        position={Position.Top}
        type={'target'}
      />
      <div className={cx(styles.card, styles.ghost)}>
        <div className={styles.head}>
          <div
            className={styles.glyph}
            style={{ background: KIND_COLOR.task.soft, color: KIND_COLOR.task.line }}
          >
            <Icon icon={KIND_ICON.task} size={16} />
          </div>
          <Flexbox gap={7} style={{ flex: 1, minWidth: 0, paddingBlockStart: 1 }}>
            <span className={cx(styles.title, shinyTextStyles.shinyText)}>
              {t('goalProcess.node.generating')}
            </span>
            <span className={styles.ghostBar} style={{ width: '84%' }} />
            <span className={styles.ghostBar} style={{ width: '56%' }} />
          </Flexbox>
        </div>
      </div>
    </div>
  );
});

GhostNodeView.displayName = 'GoalGraphGhostNodeView';

export default GraphNodeView;

'use client';

import { Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { FileBox, Repeat2, ShieldCheck } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';

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
  isFrontier: boolean;
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
    box-shadow: ${cssVar.boxShadowTertiary};

    transition:
      opacity 0.2s,
      box-shadow 0.15s,
      border-color 0.15s;
  `,
  chip: css`
    position: absolute;
    inset-block-start: -9px;
    inset-inline-end: 10px;

    padding-block: 1px;
    padding-inline: 6px;
    border: 1px solid;
    border-radius: 999px;

    font-size: 10px;
    line-height: 14px;

    background: ${cssVar.colorBgContainer};
  `,
  dim: css`
    opacity: 0.45;
  `,
  frontier: css`
    border-color: ${cssVar.colorPrimaryBorder};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  gate: css`
    border-color: ${cssVar.colorWarningBorder};
    background: ${cssVar.colorWarningBg};
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
    position: absolute;
    inset-block-start: -9px;
    inset-inline-start: 10px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    border-radius: 50%;

    font-size: 9px;
    font-weight: 600;
    color: ${cssVar.colorBgContainer};

    background: ${cssVar.colorText};
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
    border-color: ${cssVar.colorPrimary};
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

const useStateChip = (data: GraphNodeData): { color: string; text: string } | null => {
  const { t } = useTranslation('chat');
  const { isGate, running, stale, view } = data;
  const { node } = view;

  if (isGate) return { color: cssVar.colorWarning, text: t('goalProcess.tag.needsDecision') };
  if (stale) return { color: cssVar.colorError, text: t('goalProcess.tag.lost') };
  if (running) return { color: cssVar.colorInfo, text: t('goalProcess.node.running') };
  if (node.kind === 'work' && node.status === 'resolved')
    return { color: cssVar.colorSuccess, text: t('goalProcess.node.done') };
  if (node.kind === 'work' && (node.status === 'retired' || node.status === 'rejected'))
    return { color: cssVar.colorTextTertiary, text: t('goalProcess.tag.retired') };
  if (node.kind === 'decision' && node.status === 'resolved')
    return {
      color: cssVar.colorTextTertiary,
      text: view.humanTouches.length
        ? t('goalProcess.node.decidedByYou')
        : t('goalProcess.node.decidedByAgent'),
    };
  return null;
};

const RunningClock = memo<{ startedAt?: Date }>(({ startedAt }) => {
  const elapsed = useElapsed(startedAt);
  if (!elapsed) return null;
  return <span style={{ marginInlineStart: 'auto' }}>{elapsed}</span>;
});

RunningClock.displayName = 'GoalGraphRunningClock';

const GraphNodeView = memo<NodeProps>(({ data }) => {
  const { t } = useTranslation('chat');
  const nodeData = data as GraphNodeData;
  const { dim, isFrontier, isGate, running, selected, stale, subtitle, view } = nodeData;
  const { node } = view;
  const chip = useStateChip(nodeData);
  const palette = KIND_COLOR[node.kind];
  const isWork = node.kind === 'work';
  const attempts = view.attempts.length;

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
          isFrontier && !isGate && styles.frontier,
          isGate && styles.gate,
          stale && styles.stale,
          dim && styles.dim,
          selected && styles.selected,
        )}
      >
        {chip && (
          <span className={styles.chip} style={{ borderColor: chip.color, color: chip.color }}>
            {chip.text}
          </span>
        )}
        {view.humanTouches.length > 0 && (
          <Tooltip title={t('goalProcess.node.humanTouched')}>
            <span className={styles.human}>@</span>
          </Tooltip>
        )}
        <div className={styles.head}>
          <div className={styles.glyph} style={{ background: palette.soft, color: palette.line }}>
            <Icon icon={KIND_ICON[node.kind]} size={16} />
          </div>
          <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
            <span className={styles.title}>{node.title}</span>
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          </Flexbox>
        </div>
        {isWork && (
          <div className={styles.metrics}>
            {node.taskId ? (
              <Tooltip title={t('goalProcess.node.verifierTooltip')}>
                <span className={styles.metric}>
                  <Icon icon={ShieldCheck} size={13} />
                  {t('goalProcess.node.verifier')}
                </span>
              </Tooltip>
            ) : (
              <span className={styles.metric}>
                <Icon
                  color={TASK_STATUS_VISUALS.backlog.color}
                  icon={TASK_STATUS_VISUALS.backlog.icon}
                  size={13}
                />
                <Text fontSize={11} type={'secondary'}>
                  {t('goalProcess.node.unassigned')}
                </Text>
              </span>
            )}
            <Tooltip title={t('goalProcess.node.attemptsTooltip', { count: attempts })}>
              <span className={styles.metric}>
                <Icon icon={Repeat2} size={13} />
                {attempts}
              </span>
            </Tooltip>
            {view.artifactCount > 0 && (
              <Tooltip
                title={t('goalProcess.node.artifactsTooltip', { count: view.artifactCount })}
              >
                <span className={styles.metric}>
                  <Icon icon={FileBox} size={13} />
                  {view.artifactCount}
                </span>
              </Tooltip>
            )}
            {running && <RunningClock startedAt={view.startedAt} />}
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

export default GraphNodeView;

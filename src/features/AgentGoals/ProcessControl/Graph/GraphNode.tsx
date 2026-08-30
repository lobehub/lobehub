'use client';

import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
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
  chipDot: css`
    flex: none;
    width: 5px;
    height: 5px;
    border-radius: 50%;
  `,
  chipText: css`
    font-size: 11px;
    line-height: 16px;
    white-space: nowrap;
  `,
  dim: css`
    opacity: 0.45;
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

const useStateChip = (data: GraphNodeData): { color: string; text: string } | null => {
  const { t } = useTranslation('chat');
  const { isGate, running, stale, view } = data;
  const { node } = view;

  if (isGate) return { color: cssVar.colorWarning, text: t('goalProcess.tag.needsDecision') };
  if (stale) return { color: cssVar.colorError, text: t('goalProcess.tag.lost') };
  if (running) return { color: cssVar.colorInfo, text: t('goalProcess.node.running') };
  if (node.kind === 'task' && node.status === 'resolved')
    return { color: cssVar.colorSuccess, text: t('goalProcess.node.done') };
  if (node.kind === 'task' && (node.status === 'retired' || node.status === 'rejected'))
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
  const { dim, isGate, running, selected, stale, subtitle, view } = nodeData;
  const { node } = view;
  const chip = useStateChip(nodeData);
  const palette = KIND_COLOR[node.kind];
  const isTask = node.kind === 'task';
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
          isGate && styles.gate,
          stale && styles.stale,
          dim && styles.dim,
          selected && styles.selected,
        )}
      >
        <div className={styles.head}>
          <div className={styles.glyph} style={{ background: palette.soft, color: palette.line }}>
            <Icon icon={KIND_ICON[node.kind]} size={16} />
          </div>
          <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
            <span className={styles.title}>{node.title}</span>
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          </Flexbox>
          {/* State and human participation sit inside the card, on the header's
              trailing edge. Floating them on the card's outline collided with
              the edges and arrowheads routed around it. */}
          <Flexbox horizontal align={'center'} gap={6} style={{ flex: 'none' }}>
            {view.humanTouches.length > 0 && (
              <Tooltip title={t('goalProcess.node.humanTouched')}>
                <span className={styles.human}>@</span>
              </Tooltip>
            )}
            {chip && (
              <Flexbox horizontal align={'center'} gap={4}>
                <span className={styles.chipDot} style={{ background: chip.color }} />
                <span className={styles.chipText} style={{ color: chip.color }}>
                  {chip.text}
                </span>
              </Flexbox>
            )}
          </Flexbox>
        </div>
        {isTask && (
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

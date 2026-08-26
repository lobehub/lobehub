import { Flexbox, Text, Tooltip } from '@lobehub/ui';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { createStyles } from 'antd-style';
import {
  CircleHelp,
  FileBox,
  GitBranch,
  Lightbulb,
  ListChecks,
  Repeat2,
  ShieldCheck,
  Target,
} from 'lucide-react';
import { memo } from 'react';

import { clock, elapsed } from '../../model/format';
import type { GoalNode, NodeKind } from '../../types';
import { ActorAvatar, StatusGlyph, useKindColors, useSharedStyles } from '../shared';

// A product-grade graph card: leading kind icon on a tinted square, title + one-line subtitle, a
// status chip in the corner, and — for a Work — a metric strip along the bottom:
//   agent avatar · attempts · verifier · artifacts.
// Everything on the card is derived from the node itself; nothing is invented.

export interface GraphNodeData extends Record<string, unknown> {
  node: GoalNode;
  isFrontier: boolean;
  isGate: boolean;
  stale: boolean;
  fresh: boolean;
  dim: boolean;
  selected: boolean;
  running: boolean;
  subtitle: string;
}

const KIND_ICON: Record<NodeKind, typeof Target> = {
  goal: Target,
  problem: CircleHelp,
  work: ListChecks,
  finding: Lightbulb,
  decision: GitBranch,
};

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    box-sizing: border-box;
    width: 100%;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorBgContainer};
    box-shadow: ${token.boxShadowTertiary};

    transition:
      opacity 0.2s,
      box-shadow 0.15s,
      border-color 0.15s;
  `,
  head: css`
    display: flex;
    gap: 10px;
    align-items: flex-start;

    padding-block: 10px;
    padding-inline: 12px;
  `,
  glyph: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 30px;
    height: 30px;
    border-radius: ${token.borderRadius}px;
  `,
  title: css`
    font-size: 13px;
    font-weight: 500;
    line-height: 1.35;
  `,
  subtitle: css`
    overflow: hidden;

    font-size: 11px;
    color: ${token.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  metrics: css`
    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 12px;
    border-block-start: 1px dashed ${token.colorBorderSecondary};

    font-family: ${token.fontFamilyCode};
    font-size: 11px;
    color: ${token.colorTextTertiary};
  `,
  metric: css`
    display: flex;
    gap: 4px;
    align-items: center;
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

    background: ${token.colorBgContainer};
  `,
  frontier: css`
    border-color: ${token.colorPrimaryBorder};
    box-shadow: ${token.boxShadowSecondary};
  `,
  gate: css`
    border-color: ${token.colorWarningBorder};
    background: ${token.colorWarningBg};
  `,
  stale: css`
    border-color: ${token.colorErrorBorder};
  `,
  dim: css`
    opacity: 0.5;
  `,
  fresh: css`
    box-shadow: 0 0 0 4px ${token.colorPrimaryBorder};
  `,
  selected: css`
    border-color: ${token.colorPrimary};
  `,
  handle: css`
    width: 1px;
    min-width: 0;
    height: 1px;
    min-height: 0;
    border: none;

    opacity: 0;
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
    color: ${token.colorBgContainer};

    background: ${token.colorText};
  `,
}));

const stateChip = (data: GraphNodeData): { text: string; color: string } | null => {
  const { node, isGate, stale, running } = data;
  if (isGate) return { text: '等你决定', color: 'var(--ant-color-warning)' };
  if (node.delivered) return { text: '等你确认', color: 'var(--ant-color-warning)' };
  if (stale) return { text: '失联', color: 'var(--ant-color-error)' };
  if (running) return { text: '进行中', color: 'var(--ant-color-info)' };
  if (node.kind === 'work' && node.status === 'resolved')
    return { text: '完成', color: 'var(--ant-color-success)' };
  if (node.kind === 'work' && node.status === 'retired')
    return { text: '已放弃', color: 'var(--ant-color-text-tertiary)' };
  if (node.kind === 'decision' && node.status === 'resolved')
    return {
      text: node.authority === 'agent' ? 'AI 决定' : '你决定的',
      color: 'var(--ant-color-text-tertiary)',
    };
  return null;
};

export const GraphNodeView = memo<NodeProps>(({ data }) => {
  const d = data as GraphNodeData;
  const { node, isFrontier, isGate, stale, fresh, dim, selected, running, subtitle } = d;
  const { styles, cx } = useStyles();
  const { styles: shared } = useSharedStyles();
  const colors = useKindColors();
  const c = colors[node.kind];
  const KindIcon = KIND_ICON[node.kind];
  const chip = stateChip(d);
  const touches = node.kind === 'work' ? (node.humanTouches ?? []) : [];
  const attempts = node.attempts?.length ?? 0;
  const artifacts = node.artifacts ?? [];
  const isWork = node.kind === 'work';

  return (
    <div style={{ position: 'relative' }}>
      <Handle
        className={styles.handle}
        type="target"
        position={Position.Top}
        isConnectable={false}
      />
      <div
        className={cx(
          styles.card,
          isFrontier && !isGate && styles.frontier,
          isGate && styles.gate,
          stale && styles.stale,
          dim && !fresh && styles.dim,
          fresh && styles.fresh,
          selected && styles.selected,
        )}
      >
        {chip && (
          <span className={styles.chip} style={{ color: chip.color, borderColor: chip.color }}>
            {chip.text}
          </span>
        )}
        {touches.length > 0 && (
          <span className={styles.human} title={touches.map((t) => t.text).join('\n')}>
            你
          </span>
        )}
        <div className={styles.head}>
          <div className={styles.glyph} style={{ background: c.soft, color: c.line }}>
            <KindIcon size={16} />
          </div>
          <Flexbox gap={2} style={{ minWidth: 0, flex: 1 }}>
            <span className={styles.title}>{node.title}</span>
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          </Flexbox>
        </div>
        {isWork && (
          <div className={styles.metrics}>
            {node.task ? (
              <Tooltip title={`执行：${node.task.agent} · ${node.task.id}`}>
                <span className={styles.metric}>
                  <ActorAvatar name={node.task.agent} size={16} />
                  {node.task.agent}
                </span>
              </Tooltip>
            ) : (
              <span className={styles.metric}>
                <StatusGlyph status="backlog" size={13} />
                未派发
              </span>
            )}
            <Tooltip
              title={`已尝试 ${attempts} 次${node.status === 'active' ? '，正在第 ' + (attempts + 1) + ' 次' : ''}`}
            >
              <span className={styles.metric}>
                <Repeat2 size={13} />
                {running ? attempts + 1 : attempts}
              </span>
            </Tooltip>
            {node.hasVerifier && (
              <Tooltip title="有独立 verifier 判定这项交付">
                <span className={styles.metric}>
                  <ShieldCheck size={13} />
                  verifier
                </span>
              </Tooltip>
            )}
            {artifacts.length > 0 && (
              <Tooltip
                title={artifacts.map((a) => `${a.name}${a.size ? ` · ${a.size}` : ''}`).join('\n')}
              >
                <span className={styles.metric}>
                  <FileBox size={13} />
                  {artifacts.length}
                </span>
              </Tooltip>
            )}
            {running && node.startedAt && (
              <span className={cx(styles.metric, shared.mono)} style={{ marginLeft: 'auto' }}>
                {elapsed(clock.now - node.startedAt)}
              </span>
            )}
          </div>
        )}
      </div>
      <Handle
        className={styles.handle}
        type="source"
        position={Position.Bottom}
        isConnectable={false}
      />
    </div>
  );
});

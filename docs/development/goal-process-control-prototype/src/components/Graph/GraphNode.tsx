import { Flexbox, Text } from '@lobehub/ui';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { createStyles } from 'antd-style';
import { memo } from 'react';

import { clock, elapsed } from '../../model/format';
import type { GoalNode } from '../../types';
import { useKindColors, useSharedStyles } from '../shared';

// One react-flow custom node per graph node. Kind = shape + color (no type label inside);
// state = stroke (thick when on the frontier, dashed when not started / gate, dotted red when stale).

export interface GraphNodeData extends Record<string, unknown> {
  node: GoalNode;
  isFrontier: boolean;
  isGate: boolean;
  stale: boolean;
  fresh: boolean;
  dim: boolean;
  selected: boolean;
  running: boolean;
}

const useStyles = createStyles(({ css, token }) => ({
  base: css`
    position: relative;

    box-sizing: border-box;
    padding-block: 10px;
    padding-inline: 14px;
    border: 1.5px solid;

    font-size: 13px;
    color: ${token.colorText};

    transition:
      opacity 0.2s,
      box-shadow 0.15s,
      border-width 0.15s;
  `,
  work: css`
    border-radius: 10px;
  `,
  goal: css`
    border-radius: 10px;
    font-weight: 600;
  `,
  problem: css`
    border-radius: 28px;
  `,
  finding: css`
    border-radius: 6px;
  `,
  decision: css`
    padding-inline: 24px;
    border-radius: 6px;

    /* hexagon-ish: the clip keeps the kind readable at a glance */
    clip-path: polygon(
      14px 0,
      calc(100% - 14px) 0,
      100% 50%,
      calc(100% - 14px) 100%,
      14px 100%,
      0 50%
    );
  `,
  frontier: css`
    border-width: 3px;
  `,
  notStarted: css`
    border-style: dashed;
  `,
  stale: css`
    border-color: ${token.colorError} !important;
    border-style: dotted;
  `,
  gate: css`
    border-color: ${token.colorWarning} !important;
    border-style: dashed;
    border-width: 3px;
  `,
  dim: css`
    opacity: 0.45;
  `,
  fresh: css`
    box-shadow: 0 0 0 4px ${token.colorPrimaryBorder};
  `,
  selected: css`
    box-shadow: 0 0 0 2px ${token.colorPrimary};
  `,
  task: css`
    margin-block-start: 8px;
    padding-block-start: 8px;
    border-block-start: 1px solid ${token.colorBorderSecondary};

    font-family: ${token.fontFamilyCode};
    font-size: 11px;
    color: ${token.colorTextSecondary};
  `,
  dot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${token.colorWarning};

    animation: goal-node-pulse 1.6s ease-in-out infinite;

    @keyframes goal-node-pulse {
      0%,
      100% {
        opacity: 1;
      }

      50% {
        opacity: 0.25;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
  badge: css`
    position: absolute;
    inset-block-start: -8px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    border-radius: 50%;

    font-size: 9px;
    font-weight: 600;
    color: ${token.colorBgContainer};
  `,
  badgeLeft: css`
    inset-inline-start: 8px;
    background: ${token.colorText};
  `,
  badgeRight: css`
    inset-inline-end: 8px;
  `,
  handle: css`
    width: 1px;
    min-width: 0;
    height: 1px;
    min-height: 0;
    border: none;

    opacity: 0;
  `,
}));

export const GraphNodeView = memo<NodeProps>(({ data }) => {
  const { node, isFrontier, isGate, stale, fresh, dim, selected, running } = data as GraphNodeData;
  const { styles, cx } = useStyles();
  const { styles: shared } = useSharedStyles();
  const colors = useKindColors();
  const c = colors[node.kind];
  const notStarted = node.status === 'proposed';
  const touches = node.kind === 'work' ? (node.humanTouches ?? []) : [];
  const badge = node.kind === 'decision' ? (node.authority === 'agent' ? 'AI' : '你') : null;

  return (
    <div
      className={cx(
        styles.base,
        styles[node.kind],
        isFrontier && !isGate && styles.frontier,
        notStarted && styles.notStarted,
        isGate && styles.gate,
        stale && styles.stale,
        dim && !fresh && styles.dim,
        fresh && styles.fresh,
        selected && styles.selected,
      )}
      style={{
        borderColor: c.line,
        background: notStarted ? 'var(--ant-color-bg-container)' : c.soft,
        width: '100%',
      }}
    >
      <Handle
        className={styles.handle}
        type="target"
        position={Position.Top}
        isConnectable={false}
      />
      <Text ellipsis={{ rows: 2 }} style={{ fontSize: 13, lineHeight: 1.4 }}>
        {node.title}
      </Text>
      {running && node.task && (
        <Flexbox horizontal align="center" gap={6} className={styles.task}>
          <span className={styles.dot} />
          <span className={shared.mono}>
            {node.task.agent} · 已运行{' '}
            {elapsed(clock.now - (node.startedAt ?? node.lastActivity ?? clock.now))}
          </span>
        </Flexbox>
      )}
      {touches.length > 0 && (
        <span
          className={cx(styles.badge, styles.badgeLeft)}
          title={touches.map((t) => t.text).join('\n')}
        >
          你
        </span>
      )}
      {badge && (
        <span
          className={cx(styles.badge, styles.badgeRight)}
          style={{
            background: isGate
              ? 'var(--ant-color-warning)'
              : node.authority === 'agent'
                ? c.line
                : 'var(--ant-color-text)',
          }}
        >
          {badge}
        </span>
      )}
      <Handle
        className={styles.handle}
        type="source"
        position={Position.Bottom}
        isConnectable={false}
      />
    </div>
  );
});

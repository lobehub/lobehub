import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Maximize2, Minimize2 } from 'lucide-react';
import { memo } from 'react';

import { ago, clock } from '../../model/format';
import { type Frontier, isStale } from '../../model/frontier';
import type { GoalState, NodeKind } from '../../types';
import { KIND_CN, KIND_LABEL, KindDot, useKindColors } from '../shared';
import { POS, VIEW_W, edgePath } from './layout';

const useStyles = createStyles(({ css, token }) => ({
  wrap: css`
    overflow: hidden;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;
    background: ${token.colorBgContainer};
  `,
  head: css`
    padding-block: 10px;
    padding-inline: 14px;
    border-block-end: 1px solid ${token.colorBorderSecondary};
  `,
  legend: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  svg: css`
    display: block;
    width: 100%;
    height: auto;

    .edge {
      fill: none;
      stroke: ${token.colorBorder};
      stroke-width: 1.5;
      transition:
        opacity 0.2s,
        stroke 0.2s;
    }

    .edge.dep {
      stroke-dasharray: 4 4;
    }

    .edge.dim {
      opacity: 0.3;
    }

    .edge.hot {
      opacity: 1;
      stroke: ${token.colorText};
      stroke-width: 2;
    }

    .node {
      cursor: pointer;
      transition: opacity 0.2s;
    }

    .node .main {
      stroke-width: 1.5;
      transition:
        stroke-width 0.15s,
        filter 0.15s;
    }

    .node.dim {
      opacity: 0.45;
    }

    .node.frontier .main {
      stroke-width: 3;
    }

    .node.gate .main {
      stroke-dasharray: 6 4;
      stroke-width: 3;
    }

    .node.blocked .main,
    .node.proposed .main {
      stroke-dasharray: 4 4;
    }

    .node.stale .main {
      stroke-dasharray: 2 4;
    }

    .node.selected .main {
      filter: drop-shadow(0 0 4px ${token.colorPrimaryBorder});
    }

    .node.hot .main {
      stroke-width: 3.5;
    }

    .node.fresh .main {
      filter: drop-shadow(0 0 6px ${token.colorPrimaryBorder});
    }

    .node text {
      pointer-events: none;
      font-size: 13px;
      fill: ${token.colorText};
    }

    .node text.kind {
      font-size: 10px;
      letter-spacing: 0.08em;
      fill: ${token.colorTextTertiary};
    }

    .node text.task {
      font-family: ${token.fontFamilyCode};
      font-size: 11px;
      fill: ${token.colorTextSecondary};
    }

    .node text.badge {
      font-size: 9px;
      font-weight: 600;
      fill: ${token.colorBgContainer};
    }

    .node line.sep {
      stroke: ${token.colorBorderSecondary};
    }

    .pulse {
      animation: goal-pulse 1.6s ease-in-out infinite;
    }

    @keyframes goal-pulse {
      0%,
      100% {
        opacity: 1;
      }

      50% {
        opacity: 0.25;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .pulse {
        animation: none;
      }
    }
  `,
}));

interface GraphProps {
  state: GoalState;
  frontier: Frontier;
  hotId: string | null;
  selectedId: string | null;
  freshIds: Set<string>;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  wide: boolean;
  onToggleWide: () => void;
  /** Step 1: the graph is the Agent's initial plan, editable before start. */
  isDraft?: boolean;
}

const ellipsize = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export const Graph = memo<GraphProps>(
  ({
    state,
    frontier,
    hotId,
    selectedId,
    freshIds,
    onHover,
    onSelect,
    wide,
    onToggleWide,
    isDraft,
  }) => {
    const { styles, cx } = useStyles();
    const colors = useKindColors();
    const { goal } = state;
    const ids = new Set(state.nodes.map((n) => n.id));
    const frontierIds = new Set(frontier.items.map((i) => i.node.id));
    const blockedIds = new Set(frontier.blocked.map((b) => b.node.id));
    const maxY = Math.max(...state.nodes.map((n) => POS[n.id].y + POS[n.id].h)) + 24;
    const focus = hotId || selectedId || null;

    return (
      <div className={styles.wrap}>
        <Flexbox horizontal justify="space-between" align="center" className={styles.head}>
          <Flexbox horizontal gap={12} align="center">
            <Text weight={600}>探索图</Text>
            {isDraft && (
              <Text fontSize={12} type="secondary">
                初始方案 · Agent 根据目标生成 · 开始前可以调整
              </Text>
            )}
            <Flexbox horizontal gap={10} className={styles.legend} align="center">
              {(['problem', 'work', 'finding', 'decision'] as NodeKind[]).map((k) => (
                <Flexbox key={k} horizontal gap={4} align="center">
                  <KindDot kind={k} />
                  <span>{KIND_CN[k]}</span>
                </Flexbox>
              ))}
              <span>· 粗边 = 能推进 · 虚线 = 未开始 · 你/AI 角标 = 谁决定的、有人参与过</span>
            </Flexbox>
          </Flexbox>
          <ActionIcon
            icon={wide ? Minimize2 : Maximize2}
            size="small"
            title={wide ? '还原' : '放大'}
            onClick={onToggleWide}
          />
        </Flexbox>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${VIEW_W} ${maxY}`}
          role="img"
          aria-label="Goal Graph"
        >
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L0,6 L7,3 z" fill="context-stroke" />
            </marker>
          </defs>
          {state.edges
            .filter(([a, b]) => ids.has(a) && ids.has(b))
            .map(([a, b, kind]) => {
              const hot = !!focus && (a === focus || b === focus);
              const dim = !!focus && !hot;
              return (
                <path
                  key={`${a}-${b}-${kind}`}
                  className={cx('edge', kind === 'depends_on' && 'dep', hot && 'hot', dim && 'dim')}
                  d={edgePath(a, b, kind)}
                  markerEnd={kind === 'depends_on' ? undefined : 'url(#arrow)'}
                />
              );
            })}
          {state.nodes.map((n) => {
            const p = POS[n.id];
            const c = colors[n.kind];
            const isFrontier = frontierIds.has(n.id);
            const isGate = n.kind === 'decision' && n.status === 'waiting';
            const stale = isStale(goal, n);
            const fresh = freshIds.has(n.id);
            const related = state.edges.some(
              ([a, b]) => (a === focus && b === n.id) || (b === focus && a === n.id),
            );
            const dim = focus
              ? !(n.id === focus || related)
              : n.status === 'resolved' &&
                n.kind !== 'finding' &&
                n.kind !== 'decision' &&
                !isFrontier;
            const cls = cx(
              'node',
              isFrontier && !isGate && 'frontier',
              isGate && 'gate',
              blockedIds.has(n.id) && 'blocked',
              n.status === 'proposed' && 'proposed',
              stale && 'stale',
              dim && !fresh && 'dim',
              selectedId === n.id && 'selected',
              (hotId === n.id || fresh) && 'hot',
              fresh && 'fresh',
            );
            const stroke = isGate
              ? 'var(--ant-color-warning)'
              : stale
                ? 'var(--ant-color-error)'
                : c.line;
            const fill = n.status === 'proposed' ? 'var(--ant-color-bg-container)' : c.soft;
            const running =
              n.kind === 'work' &&
              n.status === 'active' &&
              !n.delivered &&
              goal.status !== 'paused' &&
              !stale &&
              n.task &&
              n.lastActivity;
            const h = running ? 84 : p.h;
            const label =
              n.kind === 'decision'
                ? n.status === 'waiting'
                  ? '等你决定'
                  : n.authority === 'agent'
                    ? 'AGENT 决定'
                    : '你决定的'
                : n.kind === 'work' && n.terminal
                  ? 'WORK · GOAL ACCEPTANCE'
                  : KIND_LABEL[n.kind];
            const badge = n.kind === 'decision' ? (n.authority === 'agent' ? 'AI' : '你') : null;
            const touches = n.kind === 'work' ? (n.humanTouches ?? []) : [];
            return (
              <g
                key={n.id}
                className={cls}
                onMouseEnter={() => onHover(n.id)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onSelect(n.id)}
              >
                {n.kind === 'decision' ? (
                  <path
                    className="main"
                    d={`M ${p.x + 16} ${p.y} H ${p.x + p.w - 16} L ${p.x + p.w} ${p.y + p.h / 2} L ${p.x + p.w - 16} ${p.y + p.h} H ${p.x + 16} L ${p.x} ${p.y + p.h / 2} Z`}
                    fill={fill}
                    stroke={stroke}
                  />
                ) : (
                  <rect
                    className="main"
                    x={p.x}
                    y={p.y}
                    width={p.w}
                    height={h}
                    rx={n.kind === 'problem' ? 28 : n.kind === 'finding' ? 6 : 10}
                    fill={fill}
                    stroke={stroke}
                  />
                )}
                <text x={p.x + p.w / 2} y={p.y + (running ? 22 : h / 2 - 2)} textAnchor="middle">
                  {ellipsize(n.title, n.kind === 'decision' ? 20 : 24)}
                </text>
                <text
                  className="kind"
                  x={p.x + p.w / 2}
                  y={p.y + (running ? 38 : h / 2 + 14)}
                  textAnchor="middle"
                >
                  {label}
                </text>
                {running && (
                  <g>
                    <line
                      className="sep"
                      x1={p.x + 16}
                      y1={p.y + 50}
                      x2={p.x + p.w - 16}
                      y2={p.y + 50}
                    />
                    <circle className="pulse" cx={p.x + 26} cy={p.y + 67} r={3.5} fill={c.line} />
                    <text className="task" x={p.x + 36} y={p.y + 71}>
                      {n.task!.id} · {n.task!.agent} · 第 {(n.attempts?.length ?? 0) + 1} 次 ·{' '}
                      {ago(clock.now - n.lastActivity!)}
                    </text>
                  </g>
                )}
                {badge && (
                  <g>
                    <circle
                      cx={p.x + p.w - 10}
                      cy={p.y + 2}
                      r={9}
                      fill={
                        isGate
                          ? 'var(--ant-color-warning)'
                          : n.authority === 'agent'
                            ? c.line
                            : 'var(--ant-color-text)'
                      }
                    />
                    <text className="badge" x={p.x + p.w - 10} y={p.y + 5.5} textAnchor="middle">
                      {badge}
                    </text>
                  </g>
                )}
                {touches.length > 0 && (
                  <g>
                    <title>{touches.map((t) => t.text).join('\n')}</title>
                    <circle cx={p.x + 10} cy={p.y + 2} r={9} fill="var(--ant-color-text)" />
                    <text className="badge" x={p.x + 10} y={p.y + 5.5} textAnchor="middle">
                      你
                    </text>
                  </g>
                )}
                {n.delivered && (
                  <circle cx={p.x + p.w - 8} cy={p.y + 8} r={5} fill="var(--ant-color-warning)" />
                )}
              </g>
            );
          })}
        </svg>
      </div>
    );
  },
);

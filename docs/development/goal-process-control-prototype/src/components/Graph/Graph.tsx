import { ActionIcon, Flexbox, Segmented, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Maximize2, X } from 'lucide-react';
import { memo, useMemo } from 'react';

import { clock, elapsed } from '../../model/format';
import { type Frontier, isStale } from '../../model/frontier';
import type { GoalNode, GoalState, NodeKind } from '../../types';
import { KIND_CN, KindDot, useKindColors } from '../shared';
import { POS, VIEW_W, edgePath } from './layout';

// Exploration graph. No chrome around it; two views:
//   stage — what got us here, what is moving now, and what the next advance can unlock (default)
//   all   — the whole graph
// Fullscreen is a real overlay, not a wider column. Kinds are told apart by shape + color only.

const useStyles = createStyles(({ css, token }) => ({
  head: css`
    padding-block: 4px;
  `,
  legend: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  overlay: css`
    position: fixed;
    z-index: 1000;
    inset: 0;

    display: flex;
    flex-direction: column;

    padding-block: 12px 24px;
    padding-inline: 24px;

    background: ${token.colorBgContainer};
  `,
  overlayBody: css`
    overflow: auto;
    flex: 1;
    min-height: 0;
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

export type GraphView = 'stage' | 'all';

interface GraphProps {
  state: GoalState;
  frontier: Frontier;
  hotId: string | null;
  selectedId: string | null;
  freshIds: Set<string>;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  view: GraphView;
  onViewChange: (v: GraphView) => void;
  fullscreen: boolean;
  onFullscreen: (v: boolean) => void;
}

const ellipsize = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * Stage view: nodes that are done / moving / waiting on you, plus the nodes the next advance can
 * unlock (blocked only by things that are moving or ready). Deeper future is hidden.
 */
const stageNodes = (state: GoalState, frontier: Frontier) => {
  const active = new Set<string>();
  state.nodes.forEach((n) => {
    if (n.kind === 'goal') active.add(n.id);
    if (n.status !== 'proposed') active.add(n.id);
  });
  frontier.items.forEach((i) => active.add(i.node.id));
  const visible = new Set(active);
  frontier.blocked.forEach((b) => {
    if (b.blockers.every((x) => active.has(x.id))) visible.add(b.node.id);
  });
  return visible;
};

export const Graph = memo<GraphProps>(
  ({
    state,
    frontier,
    hotId,
    selectedId,
    freshIds,
    onHover,
    onSelect,
    view,
    onViewChange,
    fullscreen,
    onFullscreen,
  }) => {
    const { styles, cx } = useStyles();
    const colors = useKindColors();
    const { goal } = state;
    const visibleIds = useMemo(
      () => (view === 'all' ? new Set(state.nodes.map((n) => n.id)) : stageNodes(state, frontier)),
      [state, frontier, view],
    );
    const nodes = state.nodes.filter((n) => visibleIds.has(n.id));
    const frontierIds = new Set(frontier.items.map((i) => i.node.id));
    const maxY = Math.max(...nodes.map((n) => POS[n.id].y + POS[n.id].h)) + 24;
    const focus = hotId || selectedId || null;

    const head = (
      <Flexbox horizontal justify="space-between" align="center" className={styles.head}>
        <Flexbox horizontal gap={12} align="center">
          <Text fontSize={16} weight={600}>
            探索图
          </Text>
          <Segmented
            size="small"
            value={view}
            onChange={(v) => onViewChange(v as GraphView)}
            options={[
              { label: '当前阶段', value: 'stage' },
              { label: '全图', value: 'all' },
            ]}
          />
        </Flexbox>
        <Flexbox horizontal gap={12} align="center">
          <Flexbox horizontal gap={10} className={styles.legend} align="center">
            {(['problem', 'work', 'finding', 'decision'] as NodeKind[]).map((k) => (
              <Flexbox key={k} horizontal gap={4} align="center">
                <KindDot kind={k} />
                <span>{KIND_CN[k]}</span>
              </Flexbox>
            ))}
          </Flexbox>
          <ActionIcon
            icon={fullscreen ? X : Maximize2}
            size="small"
            title={fullscreen ? '退出全屏' : '全屏'}
            onClick={() => onFullscreen(!fullscreen)}
          />
        </Flexbox>
      </Flexbox>
    );

    const renderNode = (n: GoalNode) => {
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
        : n.status === 'resolved' && n.kind === 'work' && !isFrontier;
      const cls = cx(
        'node',
        isFrontier && !isGate && 'frontier',
        isGate && 'gate',
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
      const h = running ? 78 : p.h;
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
          <text x={p.x + p.w / 2} y={p.y + (running ? 26 : h / 2 + 5)} textAnchor="middle">
            {ellipsize(n.title, n.kind === 'decision' ? 20 : 24)}
          </text>
          {running && (
            <g>
              <line className="sep" x1={p.x + 16} y1={p.y + 42} x2={p.x + p.w - 16} y2={p.y + 42} />
              <circle
                className="pulse"
                cx={p.x + 26}
                cy={p.y + 60}
                r={3.5}
                fill="var(--ant-color-warning)"
              />
              <text className="task" x={p.x + 36} y={p.y + 64}>
                {n.task!.agent} · 已运行{' '}
                {elapsed(clock.now - (n.startedAt ?? n.lastActivity ?? clock.now))}
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
    };

    const svg = (
      <svg
        className={styles.svg}
        viewBox={`0 0 ${VIEW_W} ${maxY}`}
        role="img"
        aria-label="Goal Graph"
        style={fullscreen ? { maxWidth: 1400, margin: '0 auto' } : undefined}
      >
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" fill="context-stroke" />
          </marker>
        </defs>
        {state.edges
          .filter(([a, b]) => visibleIds.has(a) && visibleIds.has(b))
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
        {nodes.map(renderNode)}
      </svg>
    );

    if (fullscreen)
      return (
        <div className={styles.overlay}>
          {head}
          <div className={styles.overlayBody}>{svg}</div>
        </div>
      );

    return (
      <Flexbox gap={4}>
        {head}
        {svg}
      </Flexbox>
    );
  },
);

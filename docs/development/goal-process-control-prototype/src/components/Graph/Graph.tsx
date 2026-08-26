import { ActionIcon, Flexbox, Segmented, Text } from '@lobehub/ui';
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge as RFEdge,
  MarkerType,
  type Node as RFNode,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { createStyles } from 'antd-style';
import { Maximize2, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo } from 'react';

import { type Frontier, isStale } from '../../model/frontier';
import type { GoalState, NodeKind } from '../../types';
import { KIND_CN, KindDot, useKindColors } from '../shared';
import { GraphNodeView } from './GraphNode';
import { POS } from './layout';

// Exploration graph on react-flow: custom nodes (kind = shape + color), pan/zoom/fit, minimap-free.
// Two views: 当前阶段 (what got us here + what the next advance can unlock) and 全图.
// Fullscreen is a real overlay. No card border around the canvas.

const useStyles = createStyles(({ css, token }) => ({
  head: css`
    padding-block: 4px;
  `,
  legend: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  canvas: css`
    width: 100%;
    height: 460px;

    .react-flow__attribution {
      display: none;
    }

    .react-flow__edge-path {
      stroke: ${token.colorBorder};
      stroke-width: 1.5;
    }

    .react-flow__edge.dep .react-flow__edge-path {
      stroke-dasharray: 4 4;
    }

    .react-flow__edge.hot .react-flow__edge-path {
      stroke: ${token.colorText};
      stroke-width: 2;
    }

    .react-flow__edge.dimmed .react-flow__edge-path {
      opacity: 0.25;
    }

    .react-flow__controls-button {
      border-color: ${token.colorBorderSecondary};
      background: ${token.colorBgContainer};
      fill: ${token.colorTextSecondary};

      &:hover {
        background: ${token.colorFillTertiary};
      }
    }
  `,
  full: css`
    height: 100%;
  `,
  overlay: css`
    position: fixed;
    z-index: 1000;
    inset: 0;

    display: flex;
    flex-direction: column;

    padding-block: 12px 16px;
    padding-inline: 24px;

    background: ${token.colorBgContainer};
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
  isDraft?: boolean;
}

/** Stage view: done / moving / needs-you nodes plus whatever the next advance can unlock. */
const stageNodes = (state: GoalState, frontier: Frontier) => {
  const active = new Set<string>();
  state.nodes.forEach((n) => {
    if (n.kind === 'goal' || n.status !== 'proposed') active.add(n.id);
  });
  frontier.items.forEach((i) => active.add(i.node.id));
  const visible = new Set(active);
  frontier.blocked.forEach((b) => {
    if (b.blockers.every((x) => active.has(x.id))) visible.add(b.node.id);
  });
  return visible;
};

const Canvas = memo<GraphProps & { className: string }>(
  ({ state, frontier, hotId, selectedId, freshIds, onHover, onSelect, view, className }) => {
    const colors = useKindColors();
    const { fitView } = useReactFlow();
    const { goal } = state;
    const visibleIds = useMemo(
      () => (view === 'all' ? new Set(state.nodes.map((n) => n.id)) : stageNodes(state, frontier)),
      [state, frontier, view],
    );
    const frontierIds = useMemo(() => new Set(frontier.items.map((i) => i.node.id)), [frontier]);
    const focus = hotId || selectedId || null;

    const nodes: RFNode[] = useMemo(
      () =>
        state.nodes
          .filter((n) => visibleIds.has(n.id))
          .map((n) => {
            const p = POS[n.id];
            const isGate = n.kind === 'decision' && n.status === 'waiting';
            const stale = isStale(goal, n);
            const running =
              n.kind === 'work' &&
              n.status === 'active' &&
              !n.delivered &&
              goal.status !== 'paused' &&
              !stale &&
              !!n.task &&
              !!n.lastActivity;
            const related = state.edges.some(
              ([a, b]) => (a === focus && b === n.id) || (b === focus && a === n.id),
            );
            return {
              id: n.id,
              type: 'goalNode',
              position: { x: p.x, y: p.y },
              width: p.w,
              draggable: false,
              data: {
                node: n,
                isFrontier: frontierIds.has(n.id),
                isGate,
                stale,
                fresh: freshIds.has(n.id),
                dim: focus
                  ? !(n.id === focus || related)
                  : n.status === 'resolved' && n.kind === 'work' && !frontierIds.has(n.id),
                selected: selectedId === n.id,
                running,
              },
            } satisfies RFNode;
          }),
      [state, visibleIds, frontierIds, freshIds, focus, selectedId, goal],
    );

    const edges: RFEdge[] = useMemo(
      () =>
        state.edges
          .filter(([a, b]) => visibleIds.has(a) && visibleIds.has(b))
          .map(([a, b, kind]) => {
            // depends_on points from the blocker to the blocked node so the graph always reads downward.
            const [source, target] = kind === 'depends_on' ? [b, a] : [a, b];
            const hot = !!focus && (a === focus || b === focus);
            return {
              id: `${a}-${b}-${kind}`,
              source,
              target,
              type: 'smoothstep',
              className: [kind === 'depends_on' && 'dep', hot && 'hot', focus && !hot && 'dimmed']
                .filter(Boolean)
                .join(' '),
              markerEnd:
                kind === 'depends_on'
                  ? undefined
                  : {
                      type: MarkerType.ArrowClosed,
                      color: 'var(--ant-color-border)',
                      width: 14,
                      height: 14,
                    },
            } satisfies RFEdge;
          }),
      [state, visibleIds, focus],
    );

    useEffect(() => {
      const id = setTimeout(() => fitView({ duration: 200, padding: 0.12 }), 30);
      return () => clearTimeout(id);
    }, [view, nodes.length, fitView]);

    const nodeTypes = useMemo(() => ({ goalNode: GraphNodeView }), []);
    const handleNodeClick = useCallback((_: unknown, n: RFNode) => onSelect(n.id), [onSelect]);

    return (
      <div className={className}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          onNodeMouseEnter={(_, n) => onHover(n.id)}
          onNodeMouseLeave={() => onHover(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          maxZoom={1.6}
          fitView
        >
          <Background color={colors.goal.line} gap={20} size={1} variant={BackgroundVariant.Dots} />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>
    );
  },
);

export const Graph = memo<GraphProps>((props) => {
  const { styles, cx } = useStyles();
  const { state, frontier, view, onViewChange, fullscreen, onFullscreen, isDraft } = props;
  const hiddenCount = view === 'stage' ? state.nodes.length - stageNodes(state, frontier).size : 0;

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
        {hiddenCount > 0 && (
          <Text fontSize={12} type="secondary">
            还有 {hiddenCount} 个节点在更后面的阶段
          </Text>
        )}
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

  if (fullscreen)
    return (
      <div className={styles.overlay}>
        {head}
        <ReactFlowProvider>
          <Canvas {...props} className={cx(styles.canvas, styles.full)} />
        </ReactFlowProvider>
      </div>
    );

  return (
    <Flexbox gap={4}>
      {head}
      <ReactFlowProvider>
        <Canvas {...props} className={styles.canvas} />
      </ReactFlowProvider>
    </Flexbox>
  );
});

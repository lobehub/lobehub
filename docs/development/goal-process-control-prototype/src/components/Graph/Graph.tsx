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

import { ago, clock } from '../../model/format';
import { type Frontier, isStale } from '../../model/frontier';
import type { GoalNode, GoalState, NodeKind } from '../../types';
import { KIND_CN, KindDot } from '../shared';
import { GraphNodeView } from './GraphNode';
import { POS } from './layout';

// Exploration graph on react-flow with card nodes (GraphNode.tsx). Two views: 当前阶段 (what got us
// here + what the next advance unlocks) and 全图. Fullscreen is a real overlay. Edges are labelled by
// relation so the map reads without a legend for edges.

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
    height: 620px;

    .react-flow__attribution {
      display: none;
    }

    .react-flow__edge-path {
      stroke: ${token.colorBorder};
      stroke-width: 1.5;
    }

    .react-flow__edge.dep .react-flow__edge-path {
      stroke-dasharray: 5 4;
    }

    .react-flow__edge.hot .react-flow__edge-path {
      stroke: ${token.colorPrimary};
      stroke-width: 2;
    }

    .react-flow__edge.dimmed {
      opacity: 0.3;
    }

    .react-flow__edge-textbg {
      fill: ${token.colorBgLayout};
    }

    .react-flow__edge-text {
      font-size: 10px;
      fill: ${token.colorTextTertiary};
    }

    .react-flow__controls {
      box-shadow: ${token.boxShadowTertiary};
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

    background: ${token.colorBgLayout};
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

const EDGE_LABEL: Record<string, string> = {
  decomposes: '拆出',
  depends_on: '依赖',
  investigates: '调查',
  produces: '产出',
  supports: '支持',
  contradicts: '反驳',
  leads_to: '导向',
};

/** Card width per kind — findings and decisions read shorter than a Work card. */
const WIDTH: Record<NodeKind, number> = {
  goal: 240,
  problem: 230,
  work: 260,
  finding: 240,
  decision: 250,
};

/** One line under the title: what this node is about right now. */
const subtitleOf = (n: GoalNode, state: GoalState): string => {
  if (n.kind === 'goal')
    return state.goal.checks.length
      ? `${state.goal.checks.filter((c) => c.state === 'passed').length}/${state.goal.checks.length} 项验收通过`
      : '';
  if (n.kind === 'problem') return n.status === 'resolved' ? '已被结论回答' : '待回答';
  if (n.kind === 'finding') return n.at ? `沉淀于 ${ago(clock.now - n.at)}` : '';
  if (n.kind === 'decision')
    return n.status === 'waiting' ? '等待你的选择' : (n.body?.slice(0, 28) ?? '');
  return n.description?.slice(0, 30) ?? '';
};

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
              !!n.task;
            const related = state.edges.some(
              ([a, b]) => (a === focus && b === n.id) || (b === focus && a === n.id),
            );
            return {
              id: n.id,
              type: 'goalNode',
              position: { x: p.x, y: p.y },
              width: WIDTH[n.kind],
              draggable: false,
              data: {
                node: n,
                isFrontier: frontierIds.has(n.id),
                isGate,
                stale,
                fresh: freshIds.has(n.id),
                dim: focus ? !(n.id === focus || related) : false,
                selected: selectedId === n.id,
                running,
                subtitle: subtitleOf(n, state),
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
            // depends_on points blocker → blocked so the graph always reads downward.
            const [source, target] = kind === 'depends_on' ? [b, a] : [a, b];
            const hot = !!focus && (a === focus || b === focus);
            return {
              id: `${a}-${b}-${kind}`,
              source,
              target,
              type: 'smoothstep',
              label: kind === 'decomposes' ? undefined : EDGE_LABEL[kind],
              labelShowBg: true,
              className: [kind === 'depends_on' && 'dep', hot && 'hot', focus && !hot && 'dimmed']
                .filter(Boolean)
                .join(' '),
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: 'var(--ant-color-border)',
                width: 12,
                height: 12,
              },
            } satisfies RFEdge;
          }),
      [state, visibleIds, focus],
    );

    useEffect(() => {
      const id = setTimeout(
        () => fitView({ duration: 200, padding: 0.12, minZoom: 0.7, maxZoom: 1 }),
        30,
      );
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
          proOptions={{ hideAttribution: true }}
          minZoom={0.4}
          maxZoom={1.5}
          fitView
        >
          <Background
            color="var(--ant-color-border-secondary)"
            gap={18}
            size={1}
            variant={BackgroundVariant.Dots}
          />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>
    );
  },
);

export const Graph = memo<GraphProps>((props) => {
  const { styles, cx } = useStyles();
  const { view, onViewChange, fullscreen, onFullscreen } = props;

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

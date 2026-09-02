'use client';

import '@xyflow/react/dist/style.css';

import type { GoalGraphEdge, GoalGraphNode } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Segmented, Text } from '@lobehub/ui/base-ui';
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge as FlowEdge,
  MarkerType,
  type Node as FlowNode,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Maximize2, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GoalGraphView, GoalNodeView } from '../goalGraphViewModel';
import { KindDot } from '../shared';
import GraphNodeView, { GhostNodeView, type GraphNodeData } from './GraphNode';
import { layoutGraph, NODE_WIDTH } from './layout';

/**
 * The exploration map. Two views: 当前阶段 (what got the goal here plus what the
 * next advance unlocks) and 全图. Edges carry their relation as a label so the
 * map reads without a legend; fullscreen is a real overlay, not a taller box.
 */

const styles = createStaticStyles(({ css }) => ({
  canvas: css`
    width: 100%;
    height: 560px;

    .react-flow__attribution {
      display: none;
    }

    .react-flow__edge-path {
      stroke: ${cssVar.colorBorder};
      stroke-width: 1.25;
    }

    .react-flow__edge.goal-dep .react-flow__edge-path {
      stroke-dasharray: 5 4;
    }

    .react-flow__edge.goal-hot .react-flow__edge-path {
      stroke: ${cssVar.colorPrimary};
      stroke-width: 1.75;
    }

    .react-flow__edge-textbg {
      fill: ${cssVar.colorBgLayout};
    }

    .react-flow__edge-text {
      font-size: 10px;
      fill: ${cssVar.colorTextTertiary};
    }

    .react-flow__controls-button {
      border-color: ${cssVar.colorBorderSecondary};
      background: ${cssVar.colorBgContainer};
      fill: ${cssVar.colorTextSecondary};

      &:hover {
        background: ${cssVar.colorFillTertiary};
      }
    }
  `,
  full: css`
    height: 100%;
  `,
  legend: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  /* Fullscreen chrome floats over the canvas in two corner cards instead of a
     full-width bar, so a node panned to the top edge is never hidden behind an
     opaque header strip. */
  float: css`
    position: absolute;
    z-index: 1;
    inset-block-start: 16px;

    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
  floatLeft: css`
    inset-inline-start: 16px;
  `,
  floatRight: css`
    inset-inline-end: 16px;
  `,
  overlay: css`
    position: fixed;
    z-index: 1000;
    inset: 0;
    background: ${cssVar.colorBgLayout};
  `,
}));

type GraphViewMode = 'stage' | 'all';

interface GraphProps {
  graph: GoalGraphView;
  onSelect: (nodeId: string) => void;
  /** The coordinator is still decomposing: show ghost task cards under the problem. */
  planning?: boolean;
  selectedId?: string;
}

/** `depends_on` is drawn blocker → blocked so the map always reads downward. */
const orient = (edge: GoalGraphEdge): [string, string] =>
  edge.kind === 'depends_on'
    ? [edge.targetNodeId, edge.sourceNodeId]
    : [edge.sourceNodeId, edge.targetNodeId];

/** The nodes worth showing before the user asks for the whole map. */
const stageNodeIds = (graph: GoalGraphView): Set<string> => {
  const active = new Set<string>();
  for (const view of graph.nodes) if (view.node.status !== 'proposed') active.add(view.node.id);
  for (const item of graph.frontier) active.add(item.view.node.id);
  const visible = new Set(active);
  for (const view of graph.blocked)
    if (view.blockers.every((blocker) => active.has(blocker.id))) visible.add(view.node.id);
  return visible;
};

const useSubtitle = () => {
  const { t } = useTranslation('chat');
  return useCallback(
    (view: GoalNodeView): string => {
      const { node } = view;
      switch (node.kind) {
        case 'decision': {
          return node.status === 'waiting'
            ? t('goalProcess.tag.needsDecision')
            : (view.humanTouches[0]?.resolution ?? node.description?.slice(0, 32) ?? '');
        }
        case 'finding': {
          return view.producedBy?.title ?? '';
        }
        case 'problem': {
          return node.status === 'resolved'
            ? t('goalProcess.node.answered')
            : t('goalProcess.node.unanswered');
        }
        default: {
          return node.description?.slice(0, 34) ?? '';
        }
      }
    },
    [t],
  );
};

const useEdgeLabel = () => {
  const { t } = useTranslation('chat');
  return useCallback(
    (kind: GoalGraphEdge['kind']): string | undefined => {
      switch (kind) {
        case 'contradicts': {
          return t('goalProcess.edge.contradicts');
        }
        case 'depends_on': {
          return t('goalProcess.edge.dependsOn');
        }
        case 'investigates': {
          return t('goalProcess.edge.investigates');
        }
        case 'leads_to': {
          return t('goalProcess.edge.leadsTo');
        }
        case 'produces': {
          return t('goalProcess.edge.produces');
        }
        case 'supports': {
          return t('goalProcess.edge.supports');
        }
        // `decomposes` is the skeleton of the map; labelling every branch edge is noise.
        default: {
          return undefined;
        }
      }
    },
    [t],
  );
};

const nodeTypes = { goalGhost: GhostNodeView, goalNode: GraphNodeView };

/** Ghost placeholders rendered beneath the problem while planning runs. */
const GHOST_COUNT = 3;
const GHOST_GAP = 32;
const GHOST_RANK_GAP = 56;
const GHOST_HEIGHT = 88;

const Canvas = memo<GraphProps & { className: string; interactive: boolean; view: GraphViewMode }>(
  ({ className, graph, interactive, onSelect, planning, selectedId, view }) => {
    const { fitView } = useReactFlow();
    const subtitleOf = useSubtitle();
    const edgeLabel = useEdgeLabel();

    const visibleIds = useMemo(
      () =>
        view === 'all' ? new Set(graph.nodes.map((item) => item.node.id)) : stageNodeIds(graph),
      [graph, view],
    );
    const positions = useMemo(() => {
      const nodes: GoalGraphNode[] = graph.nodes
        .filter((item) => visibleIds.has(item.node.id))
        .map((item) => item.node);
      const edges = graph.edges.filter(
        (edge) => visibleIds.has(edge.sourceNodeId) && visibleIds.has(edge.targetNodeId),
      );
      return layoutGraph(nodes, edges);
    }, [graph, visibleIds]);

    const ghosts = useMemo(() => {
      if (!planning) return [];
      const problem = graph.nodes.find((item) => item.node.kind === 'problem');
      const box = problem ? positions[problem.node.id] : undefined;
      const centerX = box ? box.x + box.width / 2 : 0;
      const y = box ? box.y + box.height + GHOST_RANK_GAP : 0;
      const width = NODE_WIDTH.task;
      const total = width * GHOST_COUNT + GHOST_GAP * (GHOST_COUNT - 1);
      return Array.from({ length: GHOST_COUNT }, (_, i) => ({
        id: `goal-ghost-${i}`,
        sourceId: problem && box ? problem.node.id : undefined,
        x: centerX - total / 2 + i * (width + GHOST_GAP),
        y,
      }));
    }, [planning, graph, positions]);

    // Inline, the canvas hugs its content: a two-node graph in a fixed 560px
    // frame is mostly empty margin, and `fitView` then shrinks the nodes to
    // fill it. Sizing the frame from the layout keeps small graphs at natural
    // node scale; 560px stays the ceiling so large graphs still zoom out.
    const inlineHeight = useMemo(() => {
      const boxes = Object.values(positions);
      if (boxes.length === 0 && ghosts.length === 0) return 216;
      const top = Math.min(...boxes.map((box) => box.y), ...ghosts.map((ghost) => ghost.y));
      const bottom = Math.max(
        ...boxes.map((box) => box.y + box.height),
        ...ghosts.map((ghost) => ghost.y + GHOST_HEIGHT),
      );
      return Math.min(560, Math.max(216, bottom - top + 72));
    }, [positions, ghosts]);

    const ghostFlowNodes: FlowNode[] = useMemo(
      () =>
        ghosts.map((ghost) => ({
          data: {},
          draggable: false,
          id: ghost.id,
          position: { x: ghost.x, y: ghost.y },
          selectable: false,
          type: 'goalGhost',
          width: NODE_WIDTH.task,
        })),
      [ghosts],
    );

    const flowNodes: FlowNode[] = useMemo(
      () =>
        graph.nodes
          .filter((item) => visibleIds.has(item.node.id))
          .map((item) => {
            const box = positions[item.node.id];
            const isGate = item.node.kind === 'decision' && item.node.status === 'waiting';
            const data: GraphNodeData = {
              // Not started and still blocked — it is context, not the story.
              dim: item.node.status === 'proposed' && item.blockers.length > 0,
              isGate,
              running: item.node.status === 'active' && !item.isStale,
              selected: selectedId === item.node.id,
              stale: item.isStale,
              subtitle: subtitleOf(item),
              view: item,
            };
            return {
              data,
              draggable: false,
              id: item.node.id,
              position: { x: box?.x ?? 0, y: box?.y ?? 0 },
              type: 'goalNode',
              width: NODE_WIDTH[item.node.kind],
            } satisfies FlowNode;
          }),
      [graph, visibleIds, positions, selectedId, subtitleOf],
    );

    const flowEdges: FlowEdge[] = useMemo(
      () =>
        graph.edges
          .filter((edge) => visibleIds.has(edge.sourceNodeId) && visibleIds.has(edge.targetNodeId))
          .map((edge) => {
            const [source, target] = orient(edge);
            const hot = selectedId === edge.sourceNodeId || selectedId === edge.targetNodeId;
            return {
              className: cx(edge.kind === 'depends_on' && 'goal-dep', hot && 'goal-hot'),
              id: edge.id,
              label: edgeLabel(edge.kind),
              labelShowBg: true,
              markerEnd: {
                color: cssVar.colorBorder,
                height: 12,
                type: MarkerType.ArrowClosed,
                width: 12,
              },
              source,
              target,
              type: 'default',
            } satisfies FlowEdge;
          }),
      [graph, visibleIds, selectedId, edgeLabel],
    );

    const ghostFlowEdges: FlowEdge[] = useMemo(
      () =>
        ghosts
          .filter((ghost) => ghost.sourceId)
          .map((ghost) => ({
            animated: true,
            id: `${ghost.id}-edge`,
            source: ghost.sourceId!,
            target: ghost.id,
            type: 'default',
          })),
      [ghosts],
    );

    const allNodes = useMemo(() => [...flowNodes, ...ghostFlowNodes], [flowNodes, ghostFlowNodes]);
    const allEdges = useMemo(() => [...flowEdges, ...ghostFlowEdges], [flowEdges, ghostFlowEdges]);

    useEffect(() => {
      const timer = setTimeout(
        () => fitView({ duration: 200, maxZoom: 1, minZoom: 0.6, padding: 0.12 }),
        30,
      );
      return () => clearTimeout(timer);
    }, [view, allNodes.length, fitView]);

    return (
      <div className={className} style={interactive ? undefined : { height: inlineHeight }}>
        {/* Inline, the map is a picture: it settles on `fitView` and stays
            there. Panning or zooming it inside a scrolling page moves the graph
            under the cursor while the page moves too, and leaves no way back to
            the framing the layout chose. Fullscreen is where it is navigable. */}
        <ReactFlow
          fitView
          edges={allEdges}
          maxZoom={interactive ? 1.5 : 1}
          minZoom={0.3}
          nodeTypes={nodeTypes}
          nodes={allNodes}
          nodesConnectable={false}
          nodesDraggable={false}
          panOnDrag={interactive}
          // Fullscreen reads like Figma on a trackpad: two-finger scroll pans
          // and pinch (ctrl+wheel) zooms. Wheel-to-zoom is off — on a mouse,
          // zooming stays on pinch/double-click and the +/- controls.
          panOnScroll={interactive}
          preventScrolling={interactive}
          proOptions={{ hideAttribution: true }}
          zoomOnDoubleClick={interactive}
          zoomOnPinch={interactive}
          zoomOnScroll={false}
          onNodeClick={(_, node) => {
            if (node.type !== 'goalGhost') onSelect(node.id);
          }}
        >
          <Background
            color={cssVar.colorBorderSecondary}
            gap={18}
            size={1}
            variant={BackgroundVariant.Dots}
          />
          {interactive && <Controls position={'bottom-right'} showInteractive={false} />}
        </ReactFlow>
      </div>
    );
  },
);

Canvas.displayName = 'GoalGraphCanvas';

const Graph = memo<GraphProps>((props) => {
  const { t } = useTranslation('chat');
  const [view, setView] = useState<GraphViewMode>('stage');
  const [fullscreen, setFullscreen] = useState(false);

  const titleAndViews = (
    <>
      <Text fontSize={16} weight={600}>
        {t('goalProcess.graph.title')}
      </Text>
      <Segmented
        size={'small'}
        value={view}
        options={[
          { label: t('goalProcess.graph.view.stage'), value: 'stage' },
          { label: t('goalProcess.graph.view.all'), value: 'all' },
        ]}
        onChange={(value) => setView(value as GraphViewMode)}
      />
    </>
  );
  const legend = (
    <Flexbox horizontal align={'center'} className={styles.legend} gap={10}>
      {(['problem', 'task', 'finding', 'decision'] as const).map((kind) => (
        <Flexbox horizontal align={'center'} gap={4} key={kind}>
          <KindDot kind={kind} />
          <span>{t(`goalProcess.kind.${kind}` as const)}</span>
        </Flexbox>
      ))}
    </Flexbox>
  );
  const toggle = (
    <ActionIcon
      icon={fullscreen ? X : Maximize2}
      size={'small'}
      title={fullscreen ? t('goalProcess.graph.exitFullscreen') : t('goalProcess.graph.fullscreen')}
      onClick={() => setFullscreen(!fullscreen)}
    />
  );

  if (fullscreen)
    return (
      <div className={styles.overlay}>
        <ReactFlowProvider>
          <Canvas {...props} interactive className={cx(styles.canvas, styles.full)} view={view} />
        </ReactFlowProvider>
        {/* Corner cards float over the canvas — the map owns the whole screen
            and panned content stays visible between them. */}
        <div className={cx(styles.float, styles.floatLeft)}>{titleAndViews}</div>
        <div className={cx(styles.float, styles.floatRight)}>
          {legend}
          {toggle}
        </div>
      </div>
    );

  return (
    <Flexbox gap={4}>
      <Flexbox horizontal align={'center'} justify={'space-between'} paddingBlock={4}>
        <Flexbox horizontal align={'center'} gap={12}>
          {titleAndViews}
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={12}>
          {legend}
          {toggle}
        </Flexbox>
      </Flexbox>
      <ReactFlowProvider>
        <Canvas {...props} className={styles.canvas} interactive={false} view={view} />
      </ReactFlowProvider>
    </Flexbox>
  );
});

Graph.displayName = 'GoalExplorationGraph';

export default Graph;

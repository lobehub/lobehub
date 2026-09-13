'use client';

import '@xyflow/react/dist/style.css';

import type { GoalGraphEdge } from '@lobechat/types';
import { experimentMembers } from '@lobechat/utils/goalGraph';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, Segmented, Text } from '@lobehub/ui/base-ui';
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge as FlowEdge,
  MarkerType,
  MiniMap,
  type Node as FlowNode,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronRight, Maximize2, X } from 'lucide-react';
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PortalContent } from '@/features/Portal/router';
import { usePortalPanelWidth } from '@/features/Portal/usePortalPanelWidth';
import RightPanel from '@/features/RightPanel';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import { type GoalGraphNodeKind, graphNodeKind, graphNodeLabel } from '../../Experiments/model';
import { type GoalGraphView, type GoalNodeView, isRunningNode } from '../goalGraphViewModel';
import { KindDot } from '../shared';
import { edgeDirection } from './edgeRouting';
import ExperimentGroup, { type ExperimentGroupData } from './ExperimentGroup';
import ExplorationEdge from './ExplorationEdge';
import { explorationMap } from './explorationMap';
import GraphNodeView, { GhostNodeView, type GraphNodeData } from './GraphNode';
import { hideKinds, layoutGraph, NODE_WIDTH } from './layout';
import { revealCenter } from './revealNode';
import { useExplorationNavigation } from './useExplorationNavigation';
import { useFitViewOnResize } from './useFitViewOnResize';

/**
 * The exploration map. Two views: 当前阶段 (what got the goal here plus what the
 * next advance unlocks) and 全图. Edges carry their relation as a label so the
 * map reads without a legend; the legend itself is a kind filter — click 任务
 * or 结论 off and the map relayouts around what remains. Fullscreen is a real
 * overlay, not a taller box, and carries its own right-hand portal panel so
 * node drill-down keeps working.
 */

const styles = createStaticStyles(({ css }) => ({
  canvas: css`
    position: relative;
    width: 100%;
    height: 560px;

    .react-flow__attribution {
      display: none;
    }

    .react-flow__edge-path {
      stroke: ${cssVar.colorBorder};
      stroke-width: 1.25;
    }

    /* Provenance links can cross cards, but must not intercept their actions. */
    .react-flow__edge,
    .react-flow__edge * {
      pointer-events: none;
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
  legendItem: css`
    cursor: pointer;
    user-select: none;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  /* A hidden kind stays in the legend as a dimmed toggle — the way back must
     be exactly where the way in was. */
  legendOff: css`
    opacity: 0.35;

    &:hover {
      opacity: 0.65;
    }
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
  navigation: css`
    max-width: calc(100% - 32px);
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
  floatRight: css`
    inset-inline-end: 16px;
  `,
  overlay: css`
    position: fixed;
    z-index: 1000;
    inset: 0;

    display: flex;
    flex-direction: row;

    background: ${cssVar.colorBgLayout};
  `,
  /* The corner cards anchor to the canvas area, not the whole overlay, so the
     portal panel opening on the right never slides under them. */
  overlayMain: css`
    position: relative;
    flex: 1;
    min-width: 0;
    height: 100%;
  `,
}));

type GraphViewMode = 'stage' | 'all';

interface GraphProps {
  /**
   * Fullscreen is owned by the page: the overlay replaces the page's Portal
   * panel with its own, and only the owner can keep exactly one of the two
   * mounted at a time.
   */
  fullscreen: boolean;
  graph: GoalGraphView;
  onFullscreenChange: (fullscreen: boolean) => void;
  onSelect: (nodeId: string) => void;
  /** The coordinator is still decomposing: show ghost task cards under the problem. */
  planning?: boolean;
  selectedId?: string;
}

/** The nodes worth showing before the user asks for the whole map. */
const stageNodeIds = (graph: GoalGraphView): Set<string> => {
  const active = new Set<string>();
  for (const view of graph.nodes)
    if (view.node.status !== 'proposed' || ['experiment', 'problem'].includes(view.node.kind))
      active.add(view.node.id);
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
        case 'answers': {
          return t('goalExperiment.answers');
        }
        case 'contains': {
          return undefined;
        }
        case 'derived_from': {
          return t('goalExperiment.continuedFrom');
        }
        case 'contradicts': {
          return t('goalProcess.edge.contradicts');
        }
        // `depends_on` is drawn blocker → blocked as a dashed edge — the dash
        // already reads as "blocked on"; any word on it invites a backwards
        // reading, so it carries no label.
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

const edgeTypes = { exploration: ExplorationEdge };

const nodeTypes = {
  goalExperiment: GraphNodeView,
  goalExperimentGroup: ExperimentGroup,
  goalGhost: GhostNodeView,
  goalNode: GraphNodeView,
};

const FIT_VIEW_OPTIONS = { duration: 200, maxZoom: 1, minZoom: 0.05, padding: 0.12 } as const;

/** Ghost placeholders rendered beneath the problem while planning runs. */
const GHOST_COUNT = 3;
const GHOST_GAP = 32;
const GHOST_RANK_GAP = 56;
const GHOST_HEIGHT = 88;

const Canvas = memo<
  Pick<GraphProps, 'graph' | 'onSelect' | 'planning' | 'selectedId'> & {
    className: string;
    fullscreen: boolean;
    hiddenKinds: ReadonlySet<GoalGraphNodeKind>;
    /** Bump after the frame around the canvas changes size to keep the selection in view. */
    refitKey?: boolean;
    view: GraphViewMode;
    collapsed: ReadonlySet<string>;
    onInspect: (id: string) => void;
    onEnter: (id: string) => void;
    navigation?: ReactNode;
  }
>(
  ({
    className,
    fullscreen,
    graph,
    hiddenKinds,
    onSelect,
    planning,
    refitKey,
    selectedId,
    collapsed,
    onInspect,
    onEnter,
    navigation,
    view,
  }) => {
    const { fitView, getInternalNode, getViewport, setCenter } = useReactFlow();
    const hasNavigation = !!navigation;
    const fitOptions = useMemo(
      () => ({
        ...FIT_VIEW_OPTIONS,
        // Keep fitted nodes below the canvas navigation, including fullscreen controls.
        padding: hasNavigation
          ? {
              top: fullscreen ? ('160px' as const) : ('80px' as const),
              right: '12%' as const,
              bottom: '12%' as const,
              left: '12%' as const,
            }
          : FIT_VIEW_OPTIONS.padding,
      }),
      [fullscreen, hasNavigation],
    );
    const { t } = useTranslation('chat');
    const containerRef = useRef<HTMLDivElement>(null);
    const subtitleOf = useSubtitle();
    const edgeLabel = useEdgeLabel();

    const hasExperiments = graph.nodes.some((item) => item.node.kind === 'experiment');
    const map = useMemo(
      () =>
        explorationMap(
          graph.nodes.map((item) => item.node),
          graph.edges,
          collapsed,
          hiddenKinds,
        ),
      [graph, collapsed, hiddenKinds],
    );
    const baseNodes = hasExperiments
      ? map.nodes
      : graph.nodes
          .map((item) => item.node)
          .filter((node) => view === 'all' || stageNodeIds(graph).has(node.id));
    const { bridges, visibleIds } = useMemo(
      () => hideKinds(baseNodes, graph.edges, hiddenKinds),
      [baseNodes, graph.edges, hiddenKinds],
    );
    const positions = hasExperiments
      ? map.boxes
      : layoutGraph(
          baseNodes.filter((node) => visibleIds.has(node.id)),
          [...graph.edges, ...bridges.map((bridge) => ({ ...bridge, kind: 'leads_to' as const }))],
        );

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
      return Math.min(hasExperiments ? 760 : 560, Math.max(216, bottom - top + 72));
    }, [positions, ghosts, hasExperiments]);

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
        baseNodes
          .filter((node) => visibleIds.has(node.id))
          .map((node) => {
            const item = graph.byId[node.id];
            const box = positions[item.node.id];
            const isGate = item.node.kind === 'decision' && item.node.status === 'waiting';
            const data: GraphNodeData = {
              // Not started and still blocked — it is context, not the story.
              dim: item.node.status === 'proposed' && item.blockers.length > 0,
              isGate,
              memberCount: experimentMembers(
                { nodes: graph.nodes.map((view) => view.node), edges: graph.edges },
                item.node.id,
                false,
              ).size,
              kind: graphNodeKind(graph, item),
              running: isRunningNode(item),
              selected: selectedId === item.node.id,
              stale: item.isStale,
              subtitle: subtitleOf(item),
              view: item,
            };
            const expanded = item.node.kind === 'experiment' && !collapsed.has(item.node.id);
            return {
              data: expanded
                ? ({
                    ...data,
                    onInspect: () => onInspect(item.node.id),
                    onEnter: () => onEnter(item.node.id),
                    onToggle: () => onSelect(item.node.id),
                  } satisfies ExperimentGroupData)
                : data,
              draggable: false,
              id: item.node.id,
              position: { x: box?.x ?? 0, y: box?.y ?? 0 },
              type: expanded
                ? 'goalExperimentGroup'
                : graphNodeKind(graph, item) === 'experiment'
                  ? 'goalExperiment'
                  : 'goalNode',
              parentId: hasExperiments ? map.parents.get(item.node.id) : undefined,
              ...(expanded ? { style: { width: box.width, height: box.height } } : {}),
              ariaLabel: graphNodeLabel(
                t(`goalProcess.kind.${graphNodeKind(graph, item)}`),
                item.node.title,
                item.seq,
              ),
              width: box?.width ?? NODE_WIDTH[item.node.kind],
              initialHeight: box?.height,
            } satisfies FlowNode;
          }),
      [
        graph,
        baseNodes,
        visibleIds,
        positions,
        selectedId,
        subtitleOf,
        t,
        collapsed,
        onInspect,
        onEnter,
        onSelect,
        hasExperiments,
        map.parents,
      ],
    );

    const flowEdges: FlowEdge[] = useMemo(() => {
      const marker = {
        color: cssVar.colorBorder,
        height: 12,
        type: MarkerType.ArrowClosed,
        width: 12,
      };
      const lanes = new Map<string, number>();
      const direct = (hasExperiments ? map.edges : graph.edges)
        .filter((edge) => visibleIds.has(edge.sourceNodeId) && visibleIds.has(edge.targetNodeId))
        .map((edge) => {
          const [source, target] = edgeDirection(edge);
          const pair = `${source}/${target}`;
          const lane = lanes.get(pair) ?? 0;
          lanes.set(pair, lane + 1);
          const hot = selectedId === edge.sourceNodeId || selectedId === edge.targetNodeId;
          return {
            className: cx(
              (edge.kind === 'depends_on' || ('projected' in edge && edge.projected === true)) &&
                'goal-dep',
              hot && 'goal-hot',
            ),
            id: edge.id,
            zIndex: 2,
            label:
              'projected' in edge && edge.projected === true
                ? t('goalExperiment.projectedRelation', {
                    relation: edgeLabel(edge.kind) ?? edge.kind,
                  })
                : edgeLabel(edge.kind),
            labelShowBg: true,
            markerEnd: marker,
            source,
            target,
            type: hasExperiments ? 'exploration' : 'default',
            data: { lane },
          } satisfies FlowEdge;
        });
      // A bridge stands in for a chain through hidden nodes: dashed like other
      // indirect relations, and unlabeled — any word would claim a relation the
      // hidden hop may not have.
      const bridged = bridges.map((bridge) => {
        const hot = selectedId === bridge.sourceNodeId || selectedId === bridge.targetNodeId;
        return {
          className: cx('goal-dep', hot && 'goal-hot'),
          id: `bridge:${bridge.sourceNodeId}:${bridge.targetNodeId}`,
          markerEnd: marker,
          source: bridge.sourceNodeId,
          target: bridge.targetNodeId,
          type: 'default',
        } satisfies FlowEdge;
      });
      return [...direct, ...bridged];
    }, [graph, visibleIds, bridges, selectedId, edgeLabel, hasExperiments, map.edges, t]);

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

    // The inline map is a framed overview, so keep it fitted to the space left by
    // the detail panel. Fullscreen keeps its existing user-navigation behavior.
    useFitViewOnResize(containerRef, fitView, fitOptions, !fullscreen);

    useEffect(() => {
      const timer = setTimeout(() => fitView(fitOptions), 30);
      return () => clearTimeout(timer);
    }, [view, collapsed, allNodes.length, hiddenKinds, fitView, fitOptions]);

    // The portal panel borrows width from the canvas. Refitting the whole map
    // when it slid open rescaled the graph on every first click; keep the zoom
    // and only pan when the selected card ended up under the panel. Wait out
    // the slide animation, or the canvas is measured mid-transition.
    useEffect(() => {
      if (refitKey === undefined || !selectedId) return;
      const timer = setTimeout(() => {
        const node = getInternalNode(selectedId);
        const container = containerRef.current;
        if (!node || !container) return;
        const viewport = getViewport();
        const { height, width } = container.getBoundingClientRect();
        const center = revealCenter(
          {
            ...node.internals.positionAbsolute,
            height: node.measured.height ?? 0,
            width: node.measured.width ?? 0,
          },
          viewport,
          { height, width },
        );
        if (center) void setCenter(center.x, center.y, { duration: 200, zoom: viewport.zoom });
      }, 280);
      return () => clearTimeout(timer);
    }, [refitKey, selectedId, getInternalNode, getViewport, setCenter]);

    return (
      <div
        className={className}
        ref={containerRef}
        style={fullscreen ? undefined : { height: inlineHeight }}
      >
        {/* Embedded graphs keep ordinary scrolling available to the page.
            Both views support drag, pinch, double-click and zoom controls;
            fullscreen also uses two-finger scrolling to pan. */}
        {graph.nodes.length === 0 && !planning && (
          <Flexbox
            align={'center'}
            justify={'center'}
            padding={24}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}
          >
            <Text type={'secondary'}>{t('goalExperiment.emptyGraph')}</Text>
          </Flexbox>
        )}
        <ReactFlow
          fitView
          panOnDrag
          zoomOnDoubleClick
          zoomOnPinch
          edgeTypes={edgeTypes}
          edges={allEdges}
          fitViewOptions={fitOptions}
          maxZoom={1.5}
          minZoom={0.03}
          nodeTypes={nodeTypes}
          nodes={allNodes}
          nodesConnectable={false}
          nodesDraggable={false}
          panOnScroll={fullscreen}
          preventScrolling={fullscreen}
          proOptions={{ hideAttribution: true }}
          zoomOnScroll={false}
          onNodeClick={(_, node) => {
            if (node.type !== 'goalGhost' && node.type !== 'goalExperimentGroup') onSelect(node.id);
          }}
        >
          {navigation && (
            <Panel className={styles.navigation} position={'top-left'}>
              {navigation}
            </Panel>
          )}
          <Background
            color={cssVar.colorBorderSecondary}
            gap={18}
            size={1}
            variant={BackgroundVariant.Dots}
          />
          {fullscreen && (
            <MiniMap
              pannable
              zoomable
              maskColor={cssVar.colorFillSecondary}
              nodeStrokeColor={cssVar.colorBorder}
              position={'bottom-left'}
              style={{ background: cssVar.colorBgContainer }}
              nodeColor={(node) =>
                node.type === 'goalExperimentGroup'
                  ? cssVar.colorFillTertiary
                  : cssVar.colorTextSecondary
              }
            />
          )}
          <Controls fitViewOptions={fitOptions} position={'bottom-right'} showInteractive={false} />
        </ReactFlow>
      </div>
    );
  },
);

Canvas.displayName = 'GoalGraphCanvas';

const Graph = memo<GraphProps>(({ fullscreen, onFullscreenChange, ...props }) => {
  const { t } = useTranslation('chat');
  const navigation = useExplorationNavigation(props.graph.goal.id, {
    nodes: props.graph.nodes.map((item) => item.node),
    edges: props.graph.edges,
  });
  const { collapsed, scopeId } = navigation;
  const scopeIds = new Set(navigation.nodes.map((node) => node.id));
  const scopedGraph: GoalGraphView = scopeId
    ? {
        ...props.graph,
        nodes: props.graph.nodes.filter((item) => scopeIds.has(item.node.id)),
        edges: navigation.edges,
        frontier: props.graph.frontier.filter((item) => scopeIds.has(item.view.node.id)),
        blocked: props.graph.blocked.filter((item) => scopeIds.has(item.node.id)),
      }
    : props.graph;
  const openNode = useChatStore((s) => s.openGoalNode);
  const [view, setView] = useState<GraphViewMode>('stage');
  const experiments = props.graph.nodes.filter((item) => item.node.kind === 'experiment');
  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<GoalGraphNodeKind>>(() => new Set());
  const showPortal = useChatStore(chatPortalSelectors.showPortal);
  const currentViewType = useChatStore(chatPortalSelectors.currentViewType);
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);
  // Same 'goal' width scope as the page's panel, so the drill-down keeps its
  // size when it moves between the page and the fullscreen overlay.
  const { maxWidth, minWidth, updateWidth, width } = usePortalPanelWidth(currentViewType, 'goal');

  const toggleKind = useCallback((kind: GoalGraphNodeKind) => {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  const selectNode = (nodeId: string) => {
    if (props.graph.byId[nodeId]?.node.kind === 'experiment') {
      navigation.toggle(nodeId);
    } else props.onSelect(nodeId);
  };
  const overview = experiments.length > 0 && (
    <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
      <Text fontSize={12} type={'secondary'}>
        {t('goalExperiment.overviewCount', {
          count: experiments.length,
          nodes: props.graph.nodes.length,
        })}
      </Text>
      <Button size={'small'} onClick={() => navigation.expandAll(true)}>
        {t(scopeId ? 'goalExperiment.expandScope' : 'goalExperiment.expandAll')}
      </Button>
      <Button size={'small'} onClick={() => navigation.expandAll(false)}>
        {t(scopeId ? 'goalExperiment.collapseScope' : 'goalExperiment.collapseAll')}
      </Button>
    </Flexbox>
  );
  const breadcrumbs = scopeId && (
    <Flexbox
      horizontal
      align={'center'}
      aria-label={t('goalExperiment.location')}
      gap={4}
      role={'navigation'}
      wrap={'wrap'}
    >
      <Button size={'small'} onClick={() => navigation.backTo(0)}>
        {t('goalExperiment.root')}
      </Button>
      {navigation.path.map((id, index) => (
        <Flexbox horizontal align={'center'} gap={4} key={id}>
          <ChevronRight size={14} />
          {index === navigation.path.length - 1 ? (
            <Text aria-current={'page'} fontSize={12}>
              {props.graph.byId[id]?.node.title}
            </Text>
          ) : (
            <Button size={'small'} onClick={() => navigation.backTo(index + 1)}>
              {props.graph.byId[id]?.node.title}
            </Button>
          )}
        </Flexbox>
      ))}
    </Flexbox>
  );
  const titleAndViews = (
    <>
      <Text fontSize={16} weight={600}>
        {t('goalProcess.graph.title')}
      </Text>
      {experiments.length === 0 && (
        <Segmented
          size={'small'}
          value={view}
          options={[
            { label: t('goalProcess.graph.view.stage'), value: 'stage' },
            { label: t('goalProcess.graph.view.all'), value: 'all' },
          ]}
          onChange={(value) => setView(value as GraphViewMode)}
        />
      )}
    </>
  );
  const legend = (
    <Flexbox horizontal align={'center'} className={styles.legend} gap={10}>
      {(
        [
          'problem',
          'task',
          ...(props.graph.nodes.some((view) => view.node.kind === 'experiment')
            ? ['experiment' as const]
            : []),
          'finding',
          'decision',
        ] as const
      ).map((kind) => {
        const off = hiddenKinds.has(kind);
        return (
          <Flexbox
            horizontal
            align={'center'}
            aria-pressed={!off}
            className={cx(styles.legendItem, off && styles.legendOff)}
            gap={4}
            key={kind}
            role={'button'}
            tabIndex={0}
            title={t(off ? 'goalProcess.graph.legend.show' : 'goalProcess.graph.legend.hide')}
            onClick={() => toggleKind(kind)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleKind(kind);
              }
            }}
          >
            <KindDot kind={kind} />
            <span>{t(`goalProcess.kind.${kind}` as const)}</span>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
  const toggle = (
    <ActionIcon
      icon={fullscreen ? X : Maximize2}
      size={'small'}
      title={fullscreen ? t('goalProcess.graph.exitFullscreen') : t('goalProcess.graph.fullscreen')}
      aria-label={
        fullscreen ? t('goalProcess.graph.exitFullscreen') : t('goalProcess.graph.fullscreen')
      }
      onClick={() => onFullscreenChange(!fullscreen)}
    />
  );

  if (fullscreen)
    return (
      <div className={styles.overlay}>
        <div className={styles.overlayMain}>
          <ReactFlowProvider>
            <Canvas
              {...props}
              fullscreen
              className={cx(styles.canvas, styles.full)}
              collapsed={collapsed}
              graph={scopedGraph}
              hiddenKinds={hiddenKinds}
              key={scopeId ?? 'root'}
              planning={scopeId ? false : props.planning}
              refitKey={showPortal}
              view={scopeId ? 'all' : view}
              navigation={
                <Flexbox gap={8}>
                  {titleAndViews}
                  {overview}
                  {breadcrumbs}
                </Flexbox>
              }
              onEnter={navigation.enter}
              onInspect={(id) => openNode(props.graph.goal.id, id)}
              onSelect={selectNode}
            />
          </ReactFlowProvider>
          {/* Corner cards float over the canvas — the map owns the whole screen
              and panned content stays visible between them. */}
          <div className={cx(styles.float, styles.floatRight)}>
            {legend}
            {toggle}
          </div>
        </div>
        {/* The overlay covers the page's portal panel, so it carries its own:
            clicking a node keeps the same drill-down chain without leaving the
            map. The page unmounts its copy while we are fullscreen. */}
        <RightPanel
          expand={showPortal}
          maxWidth={maxWidth}
          minWidth={minWidth}
          width={width}
          onSizeChange={(size) => updateWidth(size?.width)}
          onExpandChange={(next) => {
            if (!next) clearPortalStack();
          }}
        >
          <PortalContent />
        </RightPanel>
      </div>
    );

  return (
    <Flexbox gap={4}>
      {overview}
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
        <Canvas
          {...props}
          className={styles.canvas}
          collapsed={collapsed}
          fullscreen={false}
          graph={scopedGraph}
          hiddenKinds={hiddenKinds}
          key={scopeId ?? 'root'}
          navigation={breadcrumbs}
          planning={scopeId ? false : props.planning}
          view={scopeId ? 'all' : view}
          onEnter={navigation.enter}
          onInspect={(id) => openNode(props.graph.goal.id, id)}
          onSelect={selectNode}
        />
      </ReactFlowProvider>
    </Flexbox>
  );
});

Graph.displayName = 'GoalExplorationGraph';

export default Graph;

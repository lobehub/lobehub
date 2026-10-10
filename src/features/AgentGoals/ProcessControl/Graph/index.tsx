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
  type NodeChange,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronRight, DoorOpen, HandIcon, Maximize2, X } from 'lucide-react';
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';
import { PortalContent } from '@/features/Portal/router';
import { usePortalPanelWidth } from '@/features/Portal/usePortalPanelWidth';
import RightPanel from '@/features/RightPanel';
import { useIsDark } from '@/hooks/useIsDark';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import {
  type GoalGraphNodeKind,
  graphNodeKind,
  graphNodeLabel,
  isContainerKind,
} from '../../Experiments/model';
import { useGateCheckCopy } from '../BatchGate/useGateCheckCopy';
import {
  type GoalGraphView,
  type GoalNodeView,
  isRunningNode,
  scopeGraphView,
} from '../goalGraphViewModel';
import { GATE_COLOR, KindDot } from '../shared';
import {
  BatchExperimentProbeGroup,
  type BatchRoundData,
  BatchRoundGroup,
  CELL_VISUAL,
} from './BatchGroups';
import { type BatchLayout, layoutBatch } from './batchLayout';
import {
  type BatchGateState,
  type BatchModel,
  type BatchRound,
  buildBatchModel,
  verdictChecks,
} from './batchModel';
import { edgeDirection } from './edgeRouting';
import ExperimentGroup, { type ExperimentGroupData } from './ExperimentGroup';
import ExplorationEdge from './ExplorationEdge';
import { explorationMap } from './explorationMap';
import GraphNodeView, { GhostNodeView, type GraphNodeData, type StateChip } from './GraphNode';
import { type GraphBridge, hideKinds, type LayoutBox, layoutGraph, NODE_WIDTH } from './layout';
import {
  edgeMarkerColor,
  type EdgeTone,
  edgeTone,
  isNodeDimmed,
  MUTED_EDGE_OPACITY,
  MUTED_EDGE_OPACITY_DARK,
  nodeEmphasis,
  resolveMainline,
} from './mainline';
import { flowNodeSize, type MeasuredSizes, mergeMeasuredSizes } from './measuredSizes';
import { revealCenter } from './revealNode';
import { useExplorationNavigation } from './useExplorationNavigation';
import { useFitViewOnResize } from './useFitViewOnResize';
import { type GraphViewMode, isStageWholeMap, stageNodeIds } from './viewMode';

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

    /* The wrap-up report's mainline: the path reads as one bold line, and
       everything off it steps back. Selection still lights a muted edge. */
    .react-flow__edge.goal-mainline .react-flow__edge-path {
      stroke: ${cssVar.colorPrimary};
      stroke-width: 2.5;
    }

    /* A chapter map's detours: the line into a stray card reads in the same
       orange dash as the card's own frame. */
    .react-flow__edge.goal-detour .react-flow__edge-path {
      stroke: ${cssVar.colorWarning};
      stroke-dasharray: 6 4;
      stroke-width: 1.75;
    }

    .react-flow__edge.goal-muted:not(.goal-hot) {
      opacity: ${MUTED_EDGE_OPACITY};
    }

    .react-flow__edge.goal-hot .react-flow__edge-path {
      stroke: ${cssVar.colorPrimary};
      stroke-width: 1.75;
    }

    .react-flow__edge.goal-mainline.goal-hot .react-flow__edge-path {
      stroke-width: 2.5;
    }

    /* Off-mainline lines keep their step-back on the light canvas. On the dark
       one that same border token at a third opacity turns into background, so
       the line is lifted just enough to read; the mainline stays the boldest
       line on the map either way, so the hierarchy is not flattened. These
       dark-theme overrides carry higher specificity, so they sit last to keep
       the cascade ascending. */
    html[data-theme='dark'] & .react-flow__edge.goal-muted:not(.goal-hot) {
      opacity: ${MUTED_EDGE_OPACITY_DARK};
    }

    html[data-theme='dark'] & .react-flow__edge.goal-muted:not(.goal-hot) .react-flow__edge-path {
      stroke: ${cssVar.colorTextQuaternary};
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
  /** Not a kind filter: it names the bold line and ring the mainline is drawn with. */
  legendMainline: css`
    cursor: default;
    color: ${cssVar.colorText};
  `,
  legendMainlineSwatch: css`
    width: 14px;
    height: 3px;
    border-radius: 2px;
    background: ${cssVar.colorInfo};
  `,
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

interface GraphProps {
  /**
   * Schematic links the host adds for a route through nodes it left off the
   * map — a report chapter joining a detour to where it forked.
   */
  bridges?: GraphBridge[];
  /** Header actions after the legend — e.g. a host without fullscreen links out to the goal page. */
  extra?: ReactNode;
  /**
   * Fullscreen is owned by the page: the overlay replaces the page's Portal
   * panel with its own, and only the owner can keep exactly one of the two
   * mounted at a time. A host that cannot give up its panel (the Portal itself)
   * omits `onFullscreenChange`, and the map stays inline.
   */
  fullscreen?: boolean;
  graph: GoalGraphView;
  /** Nodes to call out on the map — a chapter's detours in the report's local map. */
  highlightedIds?: ReadonlySet<string>;
  onFullscreenChange?: (fullscreen: boolean) => void;
  onSelect: (nodeId: string) => void;
  /** The coordinator is still decomposing: show ghost task cards under the problem. */
  planning?: boolean;
  selectedId?: string;
}

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
  goalBatchExperimentProbe: BatchExperimentProbeGroup,
  goalBatchRound: BatchRoundGroup,
  goalExperiment: GraphNodeView,
  goalExperimentGroup: ExperimentGroup,
  goalGhost: GhostNodeView,
  goalNode: GraphNodeView,
};

/** Frames and groups a click passes through: their own buttons and cards act. */
const PASSIVE_NODE_TYPES = new Set([
  'goalBatchExperimentProbe',
  'goalBatchRound',
  'goalExperimentGroup',
  'goalGhost',
]);

const GATE_CHIP: Record<BatchGateState, StateChip & { key: string }> = {
  checking: { ...CELL_VISUAL.running, key: 'checking', text: '' },
  human: { ...CELL_VISUAL.human, key: 'human', text: '' },
  locked: { ...CELL_VISUAL.backlog, key: 'locked', text: '' },
  passed: { ...CELL_VISUAL.done, key: 'passed', text: '' },
  rejected: { ...CELL_VISUAL.stale, key: 'rejected', text: '' },
};

/** What a batch member card says about its role: plan vN, or the release gate. */
type BatchRole = { kind: 'assay' | 'template'; model: BatchModel; round: BatchRound };

const useBatchCopy = () => {
  const { t } = useTranslation('chat');
  const checkCopy = useGateCheckCopy();
  return useMemo(
    () => ({
      gate: (round: BatchRound, model: BatchModel): GraphNodeData['presentation'] => {
        const { key, ...chip } = GATE_CHIP[round.gate];
        // The latest verdict's checks with their results — a unit hold included —
        // and before any verdict, the plan.
        const latest = round.evaluations.at(-1);
        const judged = latest ? verdictChecks(latest) : [];
        // What the latest verdict found, at a glance: "3 ✓ · 1 ✗". Before any
        // verdict, how many checks it will run.
        const passed = judged.filter((check) => check.passed).length;
        const failed = judged.length - passed;
        // Green what passed, red what did not — the tally is the whole subtitle.
        const tally = latest ? (
          <span data-gate-tally>
            {passed > 0 && <span style={{ color: CELL_VISUAL.done.color }}>{`${passed} ✓`}</span>}
            {passed > 0 && failed > 0 && ' · '}
            {failed > 0 && <span style={{ color: cssVar.colorError }}>{`${failed} ✗`}</span>}
          </span>
        ) : (
          t('goalBatch.gate.checkCount', { count: model.gateChecks.length })
        );
        const checks = (latest ? judged : model.gateChecks).map((check) => {
          const { detail, label } = checkCopy(check);
          const mark = 'passed' in check ? (check.passed ? '✓ ' : '✗ ') : '';
          return `${mark}${label}${detail ? `（${detail}）` : ''}`;
        });
        return {
          chip: { ...chip, text: t(`goalBatch.gate.status.${key}` as any) },
          // How many conditions decide the release, and which, one hover away.
          hint: (
            <Flexbox gap={4}>
              <span>{t('goalBatch.gate.hintTitle')}</span>
              {checks.map((text, index) => (
                <span key={index}>{latest ? text : `${index + 1}. ${text}`}</span>
              ))}
            </Flexbox>
          ),
          icon: DoorOpen,
          palette: GATE_COLOR,
          // Passed / sent back / waiting sits after the title, right-aligned.
          trailingChip: true,
          subtitle: tally,
          title:
            round.revision > 1
              ? t('goalBatch.gate.titleRound', { revision: round.revision })
              : t('goalBatch.gate.title'),
        };
      },
      template: (round: BatchRound, view: GoalNodeView): GraphNodeData['presentation'] => ({
        chip: null,
        subtitle: view.node.description?.split('\n')[0] ?? '',
        title: round.forked
          ? t('goalBatch.template.forked', { revision: round.revision })
          : t('goalBatch.template.title', { revision: round.revision }),
      }),
    }),
    [t, checkCopy],
  );
};

const FIT_VIEW_OPTIONS = { duration: 200, maxZoom: 1, minZoom: 0.05, padding: 0.12 } as const;

/** Ghost placeholders rendered beneath the problem while planning runs. */
const GHOST_COUNT = 3;
const GHOST_GAP = 32;
const GHOST_RANK_GAP = 56;
const GHOST_HEIGHT = 88;

const Canvas = memo<
  Pick<
    GraphProps,
    'bridges' | 'graph' | 'highlightedIds' | 'onSelect' | 'planning' | 'selectedId'
  > & {
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
    bridges: hostBridges,
    className,
    fullscreen,
    graph,
    hiddenKinds,
    highlightedIds,
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
    const isDarkMode = useIsDark();

    const hasContainers = graph.nodes.some((item) => isContainerKind(item.node.kind));
    const batchCopy = useBatchCopy();
    // Every batch gets its read model (the folded card summarizes it); only an
    // open one lays its trials, gate and waves out on the map.
    const batches = useMemo(() => {
      const result = new Map<string, { layout?: BatchLayout; model: BatchModel }>();
      for (const item of graph.nodes) {
        if (item.node.kind !== 'batch') continue;
        const model = buildBatchModel(graph, item.node.id);
        const layout = collapsed.has(item.node.id) ? undefined : layoutBatch(graph, model);
        result.set(item.node.id, { layout, model });
      }
      return result;
    }, [graph, collapsed]);
    const batchRoles = useMemo(() => {
      const result = new Map<string, BatchRole>();
      for (const { layout, model } of batches.values()) {
        if (!layout) continue;
        for (const round of model.rounds) {
          if (round.templateId) result.set(round.templateId, { kind: 'template', model, round });
          if (round.assayId) result.set(round.assayId, { kind: 'assay', model, round });
        }
      }
      return result;
    }, [batches]);
    const containerLayouts = useMemo(
      () =>
        new Map(
          [...batches].flatMap(([id, { layout }]) =>
            layout ? [[id, layout] as [string, BatchLayout]] : [],
          ),
        ),
      [batches],
    );
    const map = useMemo(
      () =>
        explorationMap(
          graph.nodes.map((item) => item.node),
          graph.edges,
          collapsed,
          hiddenKinds,
          containerLayouts,
        ),
      [graph, collapsed, hiddenKinds, containerLayouts],
    );
    const baseNodes = hasContainers
      ? map.nodes
      : graph.nodes
          .map((item) => item.node)
          .filter((node) => view === 'all' || stageNodeIds(graph).has(node.id));
    const { bridges, visibleIds } = useMemo(() => {
      const hidden = hideKinds(baseNodes, graph.edges, hiddenKinds);
      const shown = (hostBridges ?? []).filter(
        (bridge) =>
          hidden.visibleIds.has(bridge.sourceNodeId) && hidden.visibleIds.has(bridge.targetNodeId),
      );
      return { ...hidden, bridges: [...hidden.bridges, ...shown] };
    }, [baseNodes, graph.edges, hiddenKinds, hostBridges]);
    // A card's height follows its content — a long title wraps to four lines —
    // so the per-kind estimate stacked the next rank into the cards above it.
    // The first pass lays out on the estimate; once React Flow has measured the
    // cards, the map lays out again on what is actually on screen.
    const [measuredSizes, setMeasuredSizes] = useState<MeasuredSizes>({});
    const handleNodesChange = useCallback((changes: NodeChange[]) => {
      setMeasuredSizes((previous) => mergeMeasuredSizes(previous, changes));
    }, []);
    const positions = hasContainers
      ? map.boxes
      : layoutGraph(
          baseNodes.filter((node) => visibleIds.has(node.id)),
          [...graph.edges, ...bridges.map((bridge) => ({ ...bridge, kind: 'leads_to' as const }))],
          measuredSizes,
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
      return Math.min(hasContainers ? 760 : 560, Math.max(216, bottom - top + 72));
    }, [positions, ghosts, hasContainers]);

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

    const mainline = useMemo(() => resolveMainline(graph), [graph]);
    const emphasisById = useMemo(() => {
      const result = new Map<string, ReturnType<typeof nodeEmphasis>>();
      if (!mainline) return result;
      const shape = { nodes: graph.nodes.map((view) => view.node), edges: graph.edges };
      for (const node of baseNodes) {
        const members = isContainerKind(node.kind) ? experimentMembers(shape, node.id, false) : [];
        result.set(node.id, nodeEmphasis(mainline, node, members));
      }
      return result;
    }, [mainline, graph, baseNodes]);

    // An open batch draws no frame: its pieces sit on the map at the batch's
    // own slot, under whatever holds the batch.
    const openBatchIds = useMemo(
      () => new Set([...batches].flatMap(([id, { layout }]) => (layout ? [id] : []))),
      [batches],
    );
    const placeInMap = useCallback(
      (id: string, box: LayoutBox | undefined, owner = map.parents.get(id)) => {
        const x = box?.x ?? 0;
        const y = box?.y ?? 0;
        if (owner && openBatchIds.has(owner)) {
          const slot = positions[owner];
          return {
            parentId: hasContainers ? map.parents.get(owner) : undefined,
            position: { x: x + (slot?.x ?? 0), y: y + (slot?.y ?? 0) },
          };
        }
        return { parentId: hasContainers ? owner : undefined, position: { x, y } };
      },
      [map.parents, openBatchIds, positions, hasContainers],
    );

    const flowNodes: FlowNode[] = useMemo(
      () =>
        baseNodes
          .filter((node) => visibleIds.has(node.id) && !openBatchIds.has(node.id))
          .map((node) => {
            const item = graph.byId[node.id];
            const box = positions[item.node.id];
            const batchRole = batchRoles.get(item.node.id);
            const inBatch =
              !!map.parents.get(item.node.id) && batches.has(map.parents.get(item.node.id)!);
            const waiting = item.node.kind === 'decision' && item.node.status === 'waiting';
            // Inside a batch a decision is a plain card: the hand glyph and a blue
            // chip say a person is needed, without the orange gate frame.
            const isGate = waiting && !inBatch;
            const emphasis = emphasisById.get(item.node.id);
            const highlighted = highlightedIds?.has(item.node.id) ?? false;
            const data: GraphNodeData = {
              // Not started and still blocked — it is context, not the story.
              // Once the report marked a mainline, everything off it is context too.
              // Inside a batch the gate's own chip says it is locked; a settled
              // side decision steps back instead.
              dim: inBatch
                ? !batchRole && item.node.status === 'resolved'
                : isNodeDimmed({
                    blocked: item.node.status === 'proposed' && item.blockers.length > 0,
                    emphasis,
                    highlighted,
                  }),
              highlighted,
              isGate,
              presentation:
                batchRole?.kind === 'template'
                  ? batchCopy.template(batchRole.round, item)
                  : batchRole?.kind === 'assay'
                    ? batchCopy.gate(batchRole.round, batchRole.model)
                    : inBatch && item.node.kind === 'decision'
                      ? {
                          icon: HandIcon,
                          ...(waiting
                            ? {
                                chip: {
                                  ...TASK_STATUS_VISUALS.paused,
                                  text: t('goalProcess.tag.needsDecision'),
                                },
                              }
                            : {}),
                        }
                      : undefined,
              mainline: emphasis === 'mainline',
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
            const expanded = isContainerKind(item.node.kind) && !collapsed.has(item.node.id);
            const type = expanded
              ? 'goalExperimentGroup'
              : isContainerKind(graphNodeKind(graph, item))
                ? 'goalExperiment'
                : 'goalNode';
            const measured = measuredSizes[item.node.id];
            const slot = placeInMap(item.node.id, box);
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
              position: slot.position,
              type,
              parentId: slot.parentId,
              ...(expanded ? { style: { width: box.width, height: box.height } } : {}),
              ariaLabel: graphNodeLabel(
                t(`goalProcess.kind.${graphNodeKind(graph, item)}`),
                item.node.title,
                item.seq,
              ),
              width: box?.width ?? NODE_WIDTH[item.node.kind],
              ...flowNodeSize(type, measured, box?.height),
            } satisfies FlowNode;
          }),
      [
        graph,
        baseNodes,
        highlightedIds,
        visibleIds,
        positions,
        selectedId,
        subtitleOf,
        t,
        collapsed,
        onInspect,
        onEnter,
        onSelect,
        map.parents,
        measuredSizes,
        emphasisById,
        batches,
        batchRoles,
        batchCopy,
        openBatchIds,
        placeInMap,
      ],
    );

    // The synthetic groups an open batch is drawn with: its trials, its waves
    // and one re-dispatch group per re-opened round. They are not graph nodes;
    // their cards and squares open the real node underneath.
    const batchFlowNodes: FlowNode[] = useMemo(
      () =>
        [...batches].flatMap(([batchId, { layout, model }]) => {
          if (!layout || !visibleIds.has(batchId)) return [];
          const [first] = model.rounds;
          // The roster waves a round owns, keeping each one's roster position.
          const rowsOf = (revision: number) =>
            model.waves.flatMap((cells, wave) =>
              model.waveRounds[wave] === revision ? [{ cells, wave }] : [],
            );
          return layout.groups.map((group) => {
            const round = model.rounds[group.revision - 1];
            const planView = round.templateId ? graph.byId[round.templateId] : undefined;
            const plan = planView && batchCopy.template(round, planView);
            const gate = round.assayId ? batchCopy.gate(round, model) : undefined;
            const data =
              group.kind === 'experimentProbe'
                ? {
                    onEnter: () => onEnter(batchId),
                    onSelect,
                    probes: first.probes,
                    started: first.probes.some((probe) => probe.state !== 'backlog'),
                    views: graph.byId,
                  }
                : ({
                    gate:
                      gate && round.assayId
                        ? {
                            chip: gate.chip,
                            hint: gate.hint,
                            nodeId: round.assayId,
                            tally: gate.subtitle,
                            title: gate.title as string,
                          }
                        : undefined,
                    onEnter: () => onEnter(batchId),
                    onSelect,
                    plan:
                      plan && round.templateId
                        ? {
                            nodeId: round.templateId,
                            subtitle: (plan.subtitle as string) ?? '',
                            title: plan.title as string,
                          }
                        : undefined,
                    probes: round.probes,
                    revision: group.revision,
                    rows: rowsOf(group.revision),
                    started:
                      group.revision === 1
                        ? !first.assayId || first.gate === 'passed' || first.gate === 'rejected'
                        : round.probes.some((probe) => probe.state !== 'backlog'),
                    waveSize: model.waveSize,
                  } satisfies BatchRoundData);
            return {
              data,
              draggable: false,
              id: group.id,
              ...placeInMap(group.id, group.box, batchId),
              selectable: false,
              // Width is the layout's; height hugs the content, the layout only reserves it.
              style: { width: group.box.width },
              type:
                group.kind === 'experimentProbe' ? 'goalBatchExperimentProbe' : 'goalBatchRound',
              width: group.box.width,
            } satisfies FlowNode;
          });
        }),
      [batches, visibleIds, graph.byId, onEnter, onSelect, placeInMap, batchCopy],
    );

    const flowEdges: FlowEdge[] = useMemo(() => {
      const marker = {
        color: edgeMarkerColor(undefined, isDarkMode),
        height: 12,
        type: MarkerType.ArrowClosed,
        width: 12,
      };
      const mainlineMarker = { ...marker, color: edgeMarkerColor('mainline', isDarkMode) };
      const detourMarker = { ...marker, color: edgeMarkerColor('detour', isDarkMode) };
      const isMainlineCard = (id: string) => emphasisById.get(id) === 'mainline';
      const toneOf = (edge: Parameters<typeof edgeTone>[1]) =>
        edgeTone(mainline, edge, isMainlineCard, highlightedIds);
      const markerOf = (tone: EdgeTone) =>
        tone === 'mainline' ? mainlineMarker : tone === 'detour' ? detourMarker : marker;
      const lanes = new Map<string, number>();
      const direct = (hasContainers ? map.edges : graph.edges)
        .filter((edge) => visibleIds.has(edge.sourceNodeId) && visibleIds.has(edge.targetNodeId))
        .map((edge) => {
          // An open batch has no card of its own: a link to it lands on its first piece.
          const [rawSource, rawTarget] = edgeDirection(edge);
          const source = batches.get(rawSource)?.layout?.entryId ?? rawSource;
          const target = batches.get(rawTarget)?.layout?.entryId ?? rawTarget;
          const pair = `${source}/${target}`;
          const lane = lanes.get(pair) ?? 0;
          lanes.set(pair, lane + 1);
          const hot = selectedId === edge.sourceNodeId || selectedId === edge.targetNodeId;
          const tone = toneOf(edge);
          return {
            className: cx(
              (edge.kind === 'depends_on' || ('projected' in edge && edge.projected === true)) &&
                'goal-dep',
              hot && 'goal-hot',
              tone && `goal-${tone}`,
            ),
            id: edge.id,
            label:
              'projected' in edge && edge.projected === true
                ? t('goalExperiment.projectedRelation', {
                    relation: edgeLabel(edge.kind) ?? edge.kind,
                  })
                : edgeLabel(edge.kind),
            labelShowBg: true,
            markerEnd: markerOf(tone),
            source,
            target,
            type: hasContainers ? 'exploration' : 'default',
            data: { lane },
          } satisfies FlowEdge;
        });
      // A bridge stands in for a chain through hidden nodes: dashed like other
      // indirect relations, and never named — any relation word would claim
      // something the hidden hop may not have. Only how far it skips is said.
      const bridged = bridges.map((bridge) => {
        const hot = selectedId === bridge.sourceNodeId || selectedId === bridge.targetNodeId;
        const id = `bridge:${bridge.sourceNodeId}:${bridge.targetNodeId}`;
        const tone = toneOf({ ...bridge, bridge: true, id });
        return {
          className: cx('goal-dep', hot && 'goal-hot', tone && `goal-${tone}`),
          id,
          ...(bridge.hops
            ? {
                label: t('goalProcess.graph.bridgeHops', { count: bridge.hops }),
                labelShowBg: true,
              }
            : {}),
          markerEnd: markerOf(tone),
          source: bridge.sourceNodeId,
          target: bridge.targetNodeId,
          type: 'default',
        } satisfies FlowEdge;
      });
      // An open batch's own chain, drawn as ordinary map links.
      const placed = new Set(visibleIds);
      for (const { layout } of batches.values())
        for (const group of layout?.groups ?? []) placed.add(group.id);
      const chained = [...batches.values()].flatMap(({ layout }) =>
        (layout?.edges ?? [])
          .filter((edge) => placed.has(edge.source) && placed.has(edge.target))
          .map(
            (edge) =>
              ({
                data: { lane: 0 },
                id: edge.id,
                ...(edge.label
                  ? { label: t('goalBatch.round.reviseEdge'), labelShowBg: true }
                  : {}),
                markerEnd: marker,
                source: edge.source,
                sourceHandle: edge.sourceHandle,
                target: edge.target,
                targetHandle: edge.targetHandle,
                type: 'exploration',
              }) satisfies FlowEdge,
          ),
      );
      return [...direct, ...bridged, ...chained];
    }, [
      batches,
      graph,
      visibleIds,
      bridges,
      selectedId,
      edgeLabel,
      hasContainers,
      map.edges,
      t,
      mainline,
      emphasisById,
      highlightedIds,
      isDarkMode,
    ]);

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

    const allNodes = useMemo(
      () => [...flowNodes, ...batchFlowNodes, ...ghostFlowNodes],
      [flowNodes, batchFlowNodes, ghostFlowNodes],
    );
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
          onNodesChange={handleNodesChange}
          onNodeClick={(_, node) => {
            if (!PASSIVE_NODE_TYPES.has(node.type ?? '')) onSelect(node.id);
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
                PASSIVE_NODE_TYPES.has(node.type ?? '')
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

const Graph = memo<GraphProps>(({ extra, fullscreen = false, onFullscreenChange, ...props }) => {
  const { t } = useTranslation('chat');
  const navigation = useExplorationNavigation(props.graph.goal.id, {
    nodes: props.graph.nodes.map((item) => item.node),
    edges: props.graph.edges,
  });
  const { collapsed, scopeId } = navigation;
  const scopeIds = new Set(navigation.nodes.map((node) => node.id));
  const scopedGraph: GoalGraphView = scopeId
    ? scopeGraphView(props.graph, scopeIds, navigation.edges)
    : props.graph;
  const openNode = useChatStore((s) => s.openGoalNode);
  const [preferredView, setView] = useState<GraphViewMode>('stage');
  const stageIsWholeMap = isStageWholeMap(props.graph);
  const view: GraphViewMode = stageIsWholeMap ? 'all' : preferredView;
  const containers = props.graph.nodes.filter((item) => isContainerKind(item.node.kind));
  const onlyBatches = containers.every((item) => item.node.kind === 'batch');
  // A batch never folds, so expand/collapse all only means something with experiments.
  const hasFoldable = !onlyBatches;
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
    if (isContainerKind(props.graph.byId[nodeId]?.node.kind ?? ('task' as const))) {
      navigation.toggle(nodeId);
    } else props.onSelect(nodeId);
  };
  const overview = containers.length > 0 && (
    <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
      <Text fontSize={12} type={'secondary'}>
        {t(onlyBatches ? 'goalBatch.overviewCount' : 'goalExperiment.overviewCount', {
          count: containers.length,
          nodes: props.graph.nodes.length,
        })}
      </Text>
      {hasFoldable && (
        <>
          <Button size={'small'} onClick={() => navigation.expandAll(true)}>
            {t(scopeId ? 'goalExperiment.expandScope' : 'goalExperiment.expandAll')}
          </Button>
          <Button size={'small'} onClick={() => navigation.expandAll(false)}>
            {t(scopeId ? 'goalExperiment.collapseScope' : 'goalExperiment.collapseAll')}
          </Button>
        </>
      )}
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
  const toggle = onFullscreenChange && (
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
  const titleAndViews = (
    <>
      <Text fontSize={16} weight={600}>
        {t('goalProcess.graph.title')}
      </Text>
      {containers.length === 0 && !stageIsWholeMap && (
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
      {/* Inline, the expand button sits with the view switch; fullscreen keeps
          its exit in the top-right corner card. */}
      {!fullscreen && toggle}
    </>
  );
  // Read against the map actually drawn — a scoped drill-down judges its own
  // cards, so the legend never promises a mainline the view decided to drop.
  const hasMainline = !!resolveMainline(scopedGraph);
  const legend = (
    <Flexbox horizontal align={'center'} className={styles.legend} gap={10}>
      {hasMainline && (
        <Flexbox
          horizontal
          align={'center'}
          className={styles.legendMainline}
          gap={4}
          title={t('goalProcess.graph.legend.mainlineHint')}
        >
          <span className={styles.legendMainlineSwatch} />
          <span>{t('goalProcess.graph.legend.mainline')}</span>
        </Flexbox>
      )}
      {(
        [
          'problem',
          'task',
          ...(containers.some((view) => view.node.kind === 'experiment')
            ? ['experiment' as const]
            : []),
          ...(containers.some((view) => view.node.kind === 'batch') ? ['batch' as const] : []),
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
                  {/* Title and view switch share one row, as in the inline header. */}
                  <Flexbox horizontal align={'center'} gap={12}>
                    {titleAndViews}
                  </Flexbox>
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
          {extra}
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

// oxlint-disable-next-line stylex-migration/no-emotion-styles -- @xyflow/react edge labels and control buttons take no className
import { createStaticStyles, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  Background,
  Controls,
  type Edge,
  type FitViewOptions,
  type Node,
  type NodeTypes,
  ReactFlow,
  useReactFlow,
  type Viewport,
} from '@xyflow/react';
import { useCallback, useEffect, useRef } from 'react';

import { observeWidth } from '@/features/AgentGoals/ProcessControl/Graph/useFitViewOnResize';
import { useSingleton } from '@/hooks/useSingleton';
import { sx } from '@/styles/sx';

import { FlowAnchorContext } from './flowAnchor';
import { FlowEdge } from './FlowEdge';
import type { FlowGraphData } from './flowGraph';
import { getSelectedFlowNodeId, panNodeIntoView, revealNode } from './flowViewport';

const edgeTypes = { transition: FlowEdge };

const defaultFitOptions = { maxZoom: 1, minZoom: 0.65, padding: 0.08 };
const styles = stylex.create({
  canvas: {
    overflow: 'hidden',
    flex: 'none',
    width: '100%',
    minWidth: 0,
    height: 'clamp(520px, calc(100dvh - 400px), 900px)',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
});

const fallback = createStaticStyles(({ css, cssVar }) => ({
  canvas: css`
    .react-flow__edgelabel-renderer {
      z-index: 5;
    }

    .react-flow__controls-button {
      border-color: ${cssVar.colorBorderSecondary};
      background: ${cssVar.colorBgContainer};
      fill: ${cssVar.colorTextSecondary};
    }
  `,
}));

export function FlowCanvas({
  fitOptions = defaultFitOptions,
  fullscreen = false,
  nodes,
  edges,
  nodeTypes,
  onSelect,
  viewKey,
}: {
  fitOptions?: FitViewOptions;
  fullscreen?: boolean;
  nodes: Node<FlowGraphData>[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  onSelect: (id: string) => void;
  viewKey: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { fitView, getNodesBounds, getViewport, setViewport } = useReactFlow();
  const anchorRef = useRef<string | null>(null);
  const markAnchor = useCallback((nodeId: string | null) => {
    anchorRef.current = nodeId;
  }, []);
  // The toggled group has just changed height, so follow it rather than leaving
  // the user staring at whatever slid into its place.
  useEffect(() => {
    const toggled = anchorRef.current;
    anchorRef.current = null;
    const container = ref.current;
    if (!toggled || !container) return;
    panNodeIntoView(
      { getNodesBounds, getViewport, setViewport },
      { height: container.clientHeight, width: container.clientWidth },
      toggled,
    );
  }, [nodes, getNodesBounds, getViewport, setViewport]);
  const viewports = useSingleton(
    () => new Map<string, { viewport: Viewport; width: number; height: number }>(),
  );
  const selectedId = getSelectedFlowNodeId(nodes);
  const selectedRef = useRef(selectedId);
  const clickedRef = useRef<string | undefined>(undefined);
  const walkedRef = useRef(false);
  // A click must never move the canvas out from under the pointer, but a state
  // picked from outside it (Prev / Next) has no pointer to respect, so it is
  // brought fully inside, clipped edges included.
  useEffect(() => {
    selectedRef.current = selectedId;
    walkedRef.current = Boolean(selectedId) && selectedId !== clickedRef.current;
    clickedRef.current = undefined;
    const container = ref.current;
    if (!walkedRef.current || !container) return;
    revealNode(
      { getNodesBounds, getViewport, setViewport },
      { height: container.clientHeight, width: container.clientWidth },
      selectedId,
    );
  }, [selectedId, getNodesBounds, getViewport, setViewport]);
  // The details panel opens beside the canvas when a node is picked. Refitting
  // here would throw away the zoom the user just set, so only bring the picked
  // node back into view when the narrower canvas hid it.
  useEffect(() => {
    const container = ref.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    return observeWidth(container, () =>
      (walkedRef.current ? revealNode : panNodeIntoView)(
        { getNodesBounds, getViewport, setViewport },
        { height: container.clientHeight, width: container.clientWidth },
        selectedRef.current,
      ),
    );
  }, [getNodesBounds, getViewport, setViewport]);
  useEffect(() => {
    const container = ref.current;
    const frame = requestAnimationFrame(() => {
      const saved = viewports.get(viewKey);
      if (
        saved &&
        saved.width === container?.clientWidth &&
        saved.height === container?.clientHeight
      )
        void setViewport(saved.viewport);
      else void fitView(fitOptions);
    });
    return () => {
      cancelAnimationFrame(frame);
      viewports.set(viewKey, {
        viewport: getViewport(),
        width: container?.clientWidth ?? 0,
        height: container?.clientHeight ?? 0,
      });
    };
  }, [viewKey, fullscreen, fitOptions, fitView, getViewport, setViewport, viewports]);
  return (
    // Custom nodes render inside React Flow, not under its `children`, so the
    // anchor channel has to sit above the canvas to reach a group's toggle.
    <FlowAnchorContext value={markAnchor}>
      <Flexbox
        ref={ref}
        {...sx(
          styles.canvas,
          fallback.canvas,
          fullscreen ? { flex: 1, height: '100%', minHeight: 0 } : undefined,
        )}
      >
        <ReactFlow
          fitView
          panOnDrag
          panOnScroll
          preventScrolling
          zoomOnDoubleClick
          zoomOnPinch
          colorMode="system"
          edgeTypes={edgeTypes}
          edges={edges}
          fitViewOptions={fitOptions}
          maxZoom={1.5}
          minZoom={0.08}
          nodeTypes={nodeTypes}
          nodes={nodes}
          nodesConnectable={false}
          nodesDraggable={false}
          proOptions={{ hideAttribution: true }}
          style={{ background: 'transparent' }}
          zoomOnScroll={false}
          // No onEdgeClick: the edge runs behind its own caption, so clicking
          // the caption selected the branch, opened the panel and shifted the
          // canvas out from under the pointer. Branches stay pickable in the
          // outline view; on the canvas the state card is the way in.
          onPaneClick={() => onSelect('')}
          onNodeClick={(_, n) => {
            clickedRef.current = n.id;
            onSelect(n.id);
          }}
        >
          <Background bgColor="transparent" color={cssVar.colorBorderSecondary} gap={18} size={1} />
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>
      </Flexbox>
    </FlowAnchorContext>
  );
}

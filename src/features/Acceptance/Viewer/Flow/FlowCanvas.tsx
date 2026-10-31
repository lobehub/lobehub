import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  Background,
  Controls,
  type Edge,
  type Node,
  type NodeTypes,
  ReactFlow,
  useReactFlow,
  type Viewport,
} from '@xyflow/react';
import { useEffect, useRef } from 'react';

import { observeWidth } from '@/features/AgentGoals/ProcessControl/Graph/useFitViewOnResize';
import { useSingleton } from '@/hooks/useSingleton';
import { sx } from '@/styles/sx';

import { FlowAnchorContext } from './flowAnchor';
import moduleStyles from './FlowCanvas.module.css';
import { FlowEdge } from './FlowEdge';
import type { FlowGraphData } from './flowGraph';
import { getSelectedFlowNodeId, panNodeIntoView } from './flowViewport';

const edgeTypes = { transition: FlowEdge };

const fitOptions = { maxZoom: 1, minZoom: 0.65, padding: 0.08 };
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

export function FlowCanvas({
  fullscreen = false,
  nodes,
  edges,
  nodeTypes,
  onSelect,
  viewKey,
}: {
  fullscreen?: boolean;
  nodes: Node<FlowGraphData>[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  onSelect: (id: string) => void;
  viewKey: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { fitView, getNodesBounds, getViewport, setViewport } = useReactFlow();
  const anchor = useSingleton(() => ({ current: null as string | null }));
  // The toggled group has just changed height, so follow it rather than leaving
  // the user staring at whatever slid into its place.
  useEffect(() => {
    const toggled = anchor.current;
    anchor.current = null;
    const container = ref.current;
    if (!toggled || !container) return;
    panNodeIntoView(
      { getNodesBounds, getViewport, setViewport },
      { height: container.clientHeight, width: container.clientWidth },
      toggled,
    );
  }, [nodes, anchor, getNodesBounds, getViewport, setViewport]);
  const viewports = useSingleton(
    () => new Map<string, { viewport: Viewport; width: number; height: number }>(),
  );
  const selectedId = getSelectedFlowNodeId(nodes);
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  // The details panel opens beside the canvas when a node is picked. Refitting
  // here would throw away the zoom the user just set, so only bring the picked
  // node back into view when the narrower canvas hid it.
  useEffect(() => {
    const container = ref.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    return observeWidth(container, () =>
      panNodeIntoView(
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
  }, [viewKey, fullscreen, fitView, getViewport, setViewport, viewports]);
  return (
    // Custom nodes render inside React Flow, not under its `children`, so the
    // anchor channel has to sit above the canvas to reach a group's toggle.
    <FlowAnchorContext value={anchor}>
      <Flexbox
        ref={ref}
        {...sx(
          [styles.canvas],
          moduleStyles.canvas,
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
          onNodeClick={(_, n) => onSelect(n.id)}
          onPaneClick={() => onSelect('')}
        >
          <Background bgColor="transparent" color={cssVar.colorBorderSecondary} gap={18} size={1} />
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>
      </Flexbox>
    </FlowAnchorContext>
  );
}

'use client';

import { cssVar } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { MarkerType, ReactFlowProvider } from '@xyflow/react';
import { useSize } from 'ahooks';
import { useRef, useState } from 'react';

import { FlowCanvas } from '@/features/Acceptance/Viewer/Flow/FlowCanvas';
import { buildFlowGraph } from '@/features/Acceptance/Viewer/Flow/flowGraph';
import { FlowGroup } from '@/features/Acceptance/Viewer/Flow/FlowGroup';
import { FlowNode } from '@/features/Acceptance/Viewer/Flow/FlowNode';

import { artboardActions, useArtboardStore } from '../store';
import { useJourneyView } from './useJourneyView';

const nodeTypes = { flowGroup: FlowGroup, state: FlowNode };
// The stage shares the row with the side panels, so the whole journey has to fit below the viewer's default zoom floor.
const wideFit = { maxZoom: 1, minZoom: 0.15, padding: 0.08 };
// Below this the whole journey only fits at an unreadable zoom, so the view opens on its start instead.
const NARROW_STAGE = 900;

const styles = stylex.create({
  stage: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    paddingBlockEnd: 12,
    paddingBlockStart: 56,
    paddingInline: 12,
  },
});

const FlowStage = () => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useSize(ref)?.width ?? 0;
  const journey = useJourneyView();
  const selected = useArtboardStore((s) => s.selected);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  if (!journey) return <div ref={ref} {...stylex.props(styles.stage)} />;

  const { version } = journey;
  const viewId = version.id;
  const selectedNode = selected ? journey.nodeOf(selected) : undefined;
  const graph = buildFlowGraph(
    [{ id: viewId, run: journey.run, version }],
    collapsed,
    selectedNode ? `${viewId}/${selectedNode}` : undefined,
    toggle,
    () => {},
  );
  const narrowFit = {
    ...wideFit,
    minZoom: 0.4,
    nodes: version.nodes.slice(0, 2).map((node) => ({ id: `${viewId}/${node.nodeKey}` })),
  };
  // The journey is the only group, so there is nothing to drill into.
  const nodes = graph.nodes.map((node) =>
    node.type === 'flowGroup' ? { ...node, data: { ...node.data, onEnter: undefined } } : node,
  );
  const fitOptions = width > 0 && width < NARROW_STAGE ? narrowFit : wideFit;
  const edges = graph.edges.map((edge) => ({
    ...edge,
    markerEnd: { color: cssVar.colorTextQuaternary, height: 16, type: MarkerType.Arrow, width: 16 },
    style: { stroke: cssVar.colorTextQuaternary, strokeWidth: 1.5 },
  }));

  return (
    <div ref={ref} {...stylex.props(styles.stage)}>
      <ReactFlowProvider>
        <FlowCanvas
          fullscreen
          edges={edges}
          fitOptions={fitOptions}
          nodeTypes={nodeTypes}
          nodes={nodes}
          viewKey={`${viewId}:${Math.round(width)}`}
          onSelect={(id) => {
            const nodeKey = graph.checks.get(id)?.node.nodeKey;
            artboardActions.select((nodeKey && journey.boardOf(nodeKey)) ?? null);
          }}
        />
      </ReactFlowProvider>
    </div>
  );
};

export default FlowStage;

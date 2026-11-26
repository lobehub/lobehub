import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { Edge, EdgeProps } from '@xyflow/react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react';

import { getFlowEdgeLabelLayout } from './flowEdgeLabel';

const styles = stylex.create({
  label: {
    pointerEvents: 'none',
    position: 'absolute',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '5',
    maxWidth: '200px',
    maxHeight: '94px',
    paddingBlock: '5px',
    paddingInline: '10px',
    borderRadius: '8px',
    fontSize: '12px',
    lineHeight: '18px',
    color: cssVar.colorTextSecondary,
    overflowWrap: 'anywhere',
    whiteSpace: 'normal',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: `linear-gradient(${cssVar.colorFillQuaternary}, ${cssVar.colorFillQuaternary})`,
  },
});

type TransitionEdge = Edge<{ laneOffset?: number }>;

/** Labels share the graph scale so zooming out preserves their spacing. */
export function FlowEdge(props: EdgeProps<TransitionEdge>) {
  const lane = props.data?.laneOffset ?? 0;
  const [path, labelX, labelY] = lane
    ? ([
        `M ${props.sourceX},${props.sourceY} C ${props.sourceX + (props.targetX - props.sourceX) / 3},${props.sourceY + lane} ${props.targetX - (props.targetX - props.sourceX) / 3},${props.targetY + lane} ${props.targetX},${props.targetY}`,
        (props.sourceX + props.targetX) / 2,
        (props.sourceY + props.targetY) / 2 + lane * 0.75,
      ] as const)
    : getSmoothStepPath({ ...props, borderRadius: 20, offset: 32 });
  const label = getFlowEdgeLabelLayout({ ...props, lane, labelX, labelY });
  return (
    <>
      <BaseEdge id={props.id} markerEnd={props.markerEnd} path={path} style={props.style} />
      <EdgeLabelRenderer>
        <div
          className={stylex.props(styles.label).className}
          style={{
            maxWidth: label.maxWidth,
            transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)`,
          }}
        >
          {props.label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

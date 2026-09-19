import type { Edge, EdgeProps } from '@xyflow/react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react';
import { createStaticStyles, cssVar } from 'antd-style';

import { getFlowEdgeLabelLayout } from './flowEdgeLabel';

const styles = createStaticStyles(({ css }) => ({
  // The caption reads the branch condition out; it is not a control. Clicking it
  // used to open the details panel, which narrows the canvas and shifts the page
  // column, so the caption moved out from under the pointer as if it had gone.
  // Clicks fall through to the canvas instead; the state card is the way in.
  label: css`
    pointer-events: none;

    position: absolute;

    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 5;

    max-width: 200px;
    max-height: 94px;
    padding-block: 5px;
    padding-inline: 10px;
    border-radius: 8px;

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
    white-space: normal;

    /* Filled, and opaque in both themes: the fill token is translucent, so it
       is layered over a solid surface rather than over the edge running
       underneath, which would otherwise strike the text through. */
    background-color: ${cssVar.colorBgContainer};
    background-image: linear-gradient(${cssVar.colorFillQuaternary}, ${cssVar.colorFillQuaternary});
  `,
}));

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
          className={styles.label}
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

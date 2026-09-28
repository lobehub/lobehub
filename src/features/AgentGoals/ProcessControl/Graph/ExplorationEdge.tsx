import { BaseEdge, type EdgeProps, useReactFlow } from '@xyflow/react';

import { edgeLabelPoint, routeEdge } from './edgeRouting';

/** Measured card bounds, rather than estimated layout heights, keep paths out of text. */
const ExplorationEdge = (props: EdgeProps) => {
  const { getNodes } = useReactFlow();
  const nodes = getNodes();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const boxes = nodes.map((n) => {
    let x = n.position.x,
      y = n.position.y,
      parent = n.parentId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const owner = byId.get(parent);
      if (!owner) break;
      x += owner.position.x;
      y += owner.position.y;
      parent = owner.parentId;
    }
    return {
      x,
      y,
      width: n.measured?.width ?? n.width ?? 0,
      height:
        n.type === 'goalExperimentGroup'
          ? 80
          : (n.measured?.height ?? n.height ?? n.initialHeight ?? 0),
    };
  });
  const points = routeEdge(
    { x: props.sourceX, y: props.sourceY },
    { x: props.targetX, y: props.targetY },
    boxes,
    typeof props.data?.lane === 'number' ? props.data.lane : 0,
  );
  const label = edgeLabelPoint(points);
  return (
    <BaseEdge
      id={props.id}
      label={props.label}
      labelX={label.x}
      labelY={label.y}
      markerEnd={props.markerEnd}
      path={points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ')}
      style={props.style}
    />
  );
};
export default ExplorationEdge;

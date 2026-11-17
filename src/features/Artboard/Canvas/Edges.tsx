import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { useState } from 'react';

import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import type { BoardEdge } from '../model';
import { useArtboardStore } from '../store';
import { type FlowNodeState, nodeState } from '../Verify/flow';
import { useBoardCapabilities } from '../Viewport/capabilities';
import { arrowSize, edgeArrow, edgeCurve, strokeWidthOf } from './curve';
import { EDGE_LABEL_FONT, EDGE_LABEL_MAX_WIDTH, edgeLabelMode, edgeLabelText } from './edgeLabel';
import { canvasStyles } from './styles';

interface EdgeTone {
  color: string;
  dash?: string;
  strong: boolean;
}

const toneOf = (
  edge: BoardEdge,
  verify: boolean,
  states: Record<string, FlowNodeState>,
  hot: string | null,
): EdgeTone => {
  if (verify && (states[edge.from] === 'failed' || states[edge.to] === 'failed'))
    return { color: cssVar.colorError, strong: true };
  if (hot && (edge.from === hot || edge.to === hot))
    return { color: cssVar.colorPrimary, strong: true };
  return { color: cssVar.colorTextTertiary, strong: false };
};

const Edges = ({ k }: { k: number }) => {
  const board = useBoard();
  const { journey } = useBoardCapabilities();
  const { hot, verify } = useArtboardStore((s) => ({
    hot: s.mode === 'discuss' ? s.selected : null,
    verify: s.mode === 'verify',
  }));
  const states = Object.fromEntries(
    board.edges.flatMap((e) => [e.from, e.to]).map((id) => [id, nodeState(journey, id)]),
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const shown = board.edges.map((edge) => {
    const text = edgeLabelText(edge);
    const linked = !!hot && (edge.from === hot || edge.to === hot);
    return {
      edge,
      mode: edgeLabelMode({
        crowded: edge.labelHidden,
        hovered: edge.id === hovered,
        k,
        linked,
        room: edge.room,
        text,
      }),
      text,
      tone: toneOf(edge, verify, states, hot),
    };
  });

  return (
    <>
      <svg
        height="1"
        width="1"
        style={{
          left: 0,
          overflow: 'visible',
          pointerEvents: 'none',
          position: 'absolute',
          top: 0,
        }}
      >
        {shown.map(({ edge, tone }) => {
          const width = strokeWidthOf(k, tone.strong);
          const line = {
            fill: 'none',
            stroke: tone.color,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            strokeWidth: width,
          } as const;
          return (
            <g key={edge.id}>
              <path
                {...line}
                d={edgeCurve(edge.points, arrowSize(k))}
                strokeDasharray={tone.dash
                  ?.split(' ')
                  .map((v) => Number(v) * width)
                  .join(' ')}
              />
              <path {...line} d={edgeArrow(edge.points, arrowSize(k))} />
              <path
                d={edgeCurve(edge.points)}
                fill="none"
                stroke="transparent"
                strokeWidth={16 / k}
                style={{ pointerEvents: 'stroke' }}
                onMouseEnter={() => setHovered(edge.id)}
                onMouseLeave={() => setHovered((id) => (id === edge.id ? null : id))}
              />
            </g>
          );
        })}
      </svg>
      {shown.map(({ edge, mode, text, tone }) => {
        if (mode === 'none') return null;
        if (mode === 'inline')
          return (
            <div
              key={edge.id}
              {...sx(canvasStyles.edgeText, {
                fontSize: EDGE_LABEL_FONT,
                left: edge.lx,
                maxWidth: Math.min(edge.room, EDGE_LABEL_MAX_WIDTH),
                top: edge.ly,
              })}
            >
              {text}
            </div>
          );
        return (
          <div
            key={edge.id}
            {...sx(canvasStyles.edgeLabel, {
              borderColor: tone.strong ? tone.color : undefined,
              color: tone.strong ? tone.color : undefined,
              left: edge.lx,
              top: edge.ly,
              transform: `translate(-50%, -50%) scale(${1 / k})`,
            })}
          >
            {text}
          </div>
        );
      })}
    </>
  );
};

export default Edges;

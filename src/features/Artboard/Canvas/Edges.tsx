import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { useState } from 'react';

import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import type { BoardEdge } from '../model';
import { useArtboardStore } from '../store';
import { type FlowNodeState, nodeState } from '../Verify/flow';
import { useJourneyView } from '../Verify/useJourneyView';
import { EDGE_LABEL_FONT, edgeLabelMode, edgeLabelText } from './edgeLabel';
import { arrowSize, sketchArrow, sketchLine, strokeWidthOf } from './sketch';
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
  if (verify) {
    const ends = [states[edge.from], states[edge.to]];
    if (ends.includes('failed')) return { color: cssVar.colorError, strong: true };
    if (ends.every((x) => x === 'passed')) return { color: cssVar.colorSuccess, strong: true };
    return { color: cssVar.colorTextQuaternary, dash: '4 3', strong: false };
  }
  if (hot && (edge.from === hot || edge.to === hot))
    return { color: cssVar.colorPrimary, strong: true };
  return { color: cssVar.colorTextTertiary, strong: false };
};

const Edges = ({ k }: { k: number }) => {
  const board = useBoard();
  const journey = useJourneyView();
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
      mode: edgeLabelMode({ hovered: edge.id === hovered, k, linked, room: edge.room, text }),
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
                d={sketchLine(edge.points, edge.id)}
                strokeDasharray={tone.dash
                  ?.split(' ')
                  .map((v) => Number(v) * width)
                  .join(' ')}
              />
              <path {...line} d={sketchArrow(edge.points, arrowSize(k), edge.id)} />
              <path
                d={edge.d}
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
              {...sx(canvasStyles.edgeText, undefined, {
                fontSize: EDGE_LABEL_FONT,
                left: edge.lx,
                maxWidth: edge.room,
                top: edge.ly,
              })}
            >
              {text}
            </div>
          );
        return (
          <div
            key={edge.id}
            {...sx(canvasStyles.edgeLabel, undefined, {
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

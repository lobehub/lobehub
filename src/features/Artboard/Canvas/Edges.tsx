import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { useState } from 'react';

import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import type { BoardEdge } from '../model';
import { useArtboardStore } from '../store';
import { type FlowNodeState, nodeState } from '../Verify/flow';
import { useBoardCapabilities } from '../Viewport/capabilities';
import { ARROW_STROKE_RATIO, arrowSize, edgeArrow, edgeCurve, strokeWidthOf } from './curve';
import {
  EDGE_LABEL_MAX_WIDTH,
  EDGE_LABEL_PAD,
  edgeLabelFont,
  edgeLabelMode,
  edgeLabelText,
} from './edgeLabel';
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
  return { color: cssVar.colorTextSecondary, strong: false };
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
      branch: board.boardById[edge.from]?.type === 'decision',
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
          const head = arrowSize(width);
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
                d={edgeCurve(edge.points, head)}
                strokeDasharray={tone.dash
                  ?.split(' ')
                  .map((v) => Number(v) * width)
                  .join(' ')}
              />
              <path
                {...line}
                d={edgeArrow(edge.points, head)}
                strokeWidth={width * ARROW_STROKE_RATIO}
              />
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
      {shown.map(({ branch, edge, mode, text, tone }) => {
        if (mode === 'none') return null;
        const full = mode === 'full';
        return (
          <div
            key={edge.id}
            title={text}
            {...sx(
              canvasStyles.edgeLabel,
              branch && canvasStyles.edgeBranch,
              full && canvasStyles.edgeLabelFull,
              {
                boxShadow: branch
                  ? `0 0 0 ${Math.max(2, 1 / k)}px ${cssVar.colorBorder}`
                  : undefined,
                color: tone.strong ? tone.color : undefined,
                fontSize: edgeLabelFont(k, branch),
                left: edge.lx,
                maxWidth: full
                  ? undefined
                  : Math.min(edge.room, EDGE_LABEL_MAX_WIDTH) - EDGE_LABEL_PAD / k,
                paddingInline: EDGE_LABEL_PAD,
                top: edge.ly,
              },
            )}
          >
            {text}
          </div>
        );
      })}
    </>
  );
};

export default Edges;

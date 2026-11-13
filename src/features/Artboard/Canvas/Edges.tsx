import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';

import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import type { BoardEdge } from '../model';
import { useArtboardStore } from '../store';
import { type FlowNodeState, nodeState } from '../Verify/flow';
import { useJourneyView } from '../Verify/useJourneyView';
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
    return { color: cssVar.colorTextQuaternary, dash: '8 6', strong: false };
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
  const shown = board.edges.map((edge) => ({ edge, tone: toneOf(edge, verify, states, hot) }));

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
          const markerId = `artboard-edge-${edge.id}`;
          return (
            <g key={edge.id}>
              <defs>
                <marker
                  id={markerId}
                  markerHeight="8"
                  markerWidth="8"
                  orient="auto-start-reverse"
                  refX="8"
                  refY="4"
                  viewBox="0 0 8 8"
                >
                  <path d="M0 0 L8 4 L0 8 z" fill={tone.color} />
                </marker>
              </defs>
              <path
                d={edge.d}
                fill="none"
                markerEnd={`url(#${markerId})`}
                stroke={tone.color}
                strokeWidth={(tone.strong ? 2.5 : 1.5) / k}
                strokeDasharray={tone.dash
                  ?.split(' ')
                  .map((v) => Number(v) / k)
                  .join(' ')}
              />
            </g>
          );
        })}
      </svg>
      {k >= 0.3 &&
        shown.map(({ edge, tone }) => (
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
            {edge.condition ? `${edge.label} · ${edge.condition}` : edge.label}
          </div>
        ))}
    </>
  );
};

export default Edges;

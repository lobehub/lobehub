import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';

import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import { type BoardArrow, computeArrowPath } from '../model';
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
  arrow: BoardArrow,
  verify: boolean,
  states: Record<string, FlowNodeState>,
  hot: string | null,
): EdgeTone => {
  if (verify) {
    const ends = [states[arrow.from], states[arrow.to]];
    if (ends.includes('failed')) return { color: cssVar.colorError, strong: true };
    if (ends.every((x) => x === 'passed')) return { color: cssVar.colorSuccess, strong: true };
    return { color: cssVar.colorTextQuaternary, dash: '8 6', strong: false };
  }
  if (hot && (arrow.from === hot || arrow.to === hot))
    return { color: cssVar.colorPrimary, strong: true };
  return { color: cssVar.colorTextTertiary, strong: false };
};

const Edges = ({ k }: { k: number }) => {
  const board = useBoard();
  const journey = useJourneyView();
  const { drag, hot, verify } = useArtboardStore((s) => ({
    drag: s.drag,
    hot: s.mode === 'discuss' ? s.selected : null,
    verify: s.mode === 'verify',
  }));
  const arrows = drag
    ? board.arrows.map((a) => {
        if (a.from !== drag.id && a.to !== drag.id) return a;
        const at = (id: string) => (id === drag.id ? drag : board.frameById[id]);
        return { ...a, ...computeArrowPath(at(a.from), at(a.to)) };
      })
    : board.arrows;
  const states = Object.fromEntries(
    board.arrows.flatMap((a) => [a.from, a.to]).map((id) => [id, nodeState(journey, id)]),
  );
  const shown = arrows.map((a) => ({ arrow: a, tone: toneOf(a, verify, states, hot) }));

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
        {shown.map(({ arrow, tone }) => {
          const markerId = `artboard-edge-${arrow.id}`;
          return (
            <g key={arrow.id}>
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
                d={arrow.d}
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
        shown.map(({ arrow, tone }) => (
          <div
            key={arrow.id}
            {...sx(canvasStyles.arrowLabel, undefined, {
              borderColor: tone.strong ? tone.color : undefined,
              color: tone.strong ? tone.color : undefined,
              left: arrow.lx,
              top: arrow.ly,
              transform: `translate(-50%, -50%) scale(${1 / k})`,
            })}
          >
            {arrow.label}
          </div>
        ))}
    </>
  );
};

export default Edges;

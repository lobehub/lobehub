import type { ArtboardFrame } from '@lobechat/types';

import { flowStateColor } from '@/features/Acceptance/Viewer/Flow/FlowNode';
import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import type { BoardModel } from '../model';
import { artboardActions, useArtboardStore } from '../store';
import { framePreview, nodeState } from '../Verify/flow';
import { useJourneyView } from '../Verify/useJourneyView';
import FrameBody from './FrameBody';
import FrameLabel from './FrameLabel';
import { canvasStyles } from './styles';

const isRelated = (board: BoardModel, selected: string | null, id: string) =>
  !!selected &&
  selected !== id &&
  board.frameById[selected]?.groupId === board.journeyGroupId &&
  board.arrows.some(
    (a) => (a.from === selected && a.to === id) || (a.to === selected && a.from === id),
  );

interface FrameNodeProps {
  frame: ArtboardFrame;
  k: number;
  live: boolean;
}

const FrameNode = ({ frame, k, live }: FrameNodeProps) => {
  const board = useBoard();
  const journey = useJourneyView();
  const s = useArtboardStore((st) => ({
    dragX: st.drag?.id === frame.id ? st.drag.x : undefined,
    dragY: st.drag?.id === frame.id ? st.drag.y : undefined,
    flash: st.flash.includes(frame.id),
    related: st.mode === 'discuss' && isRelated(board, st.selected, frame.id),
    selected: st.selected === frame.id,
    showReal: st.showReal,
    verify: st.mode === 'verify',
  }));

  const inJourney = frame.groupId === board.journeyGroupId;
  const muted = s.verify && !inJourney;
  const state = inJourney ? nodeState(journey, frame.id) : undefined;
  const border = s.verify && inJourney ? flowStateColor(state) : undefined;
  const preview = framePreview(journey, frame.id, s.verify && inJourney && s.showReal);

  return (
    <div
      data-board-item
      data-item-id={frame.id}
      {...sx([canvasStyles.frame, canvasStyles.appear, muted && canvasStyles.muted], undefined, {
        left: s.dragX ?? frame.x,
        top: s.dragY ?? frame.y,
      })}
      onClick={(e) => {
        e.stopPropagation();
        artboardActions.select(frame.id);
      }}
    >
      <FrameLabel
        frame={frame}
        k={k}
        linked={board.finalized && inJourney}
        state={state}
        verify={s.verify}
      />
      <div
        {...sx(
          [
            canvasStyles.frameCard,
            s.selected && canvasStyles.frameSelected,
            !s.selected && s.related && canvasStyles.frameRelated,
            s.flash && canvasStyles.flash,
          ],
          undefined,
          border ? { borderColor: border, borderWidth: 3 } : undefined,
        )}
      >
        <FrameBody
          frame={frame}
          live={live}
          imageUrl={
            frame.source.kind === 'image' ? board.imageUrls[frame.source.fileId] : undefined
          }
          screenshotUrl={
            preview.kind === 'reference'
              ? undefined
              : preview.kind === 'screenshot'
                ? preview.url
                : null
          }
        />
      </div>
    </div>
  );
};

export default FrameNode;

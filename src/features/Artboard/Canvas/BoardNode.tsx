import type { ArtboardBoardView } from '@lobechat/types';

import { flowStateColor } from '@/features/Acceptance/Viewer/Flow/FlowNode';
import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import type { BoardModel } from '../model';
import { artboardActions, useArtboardStore } from '../store';
import { boardPreview, nodeState } from '../Verify/flow';
import { useJourneyView } from '../Verify/useJourneyView';
import BoardBody from './BoardBody';
import BoardLabel from './BoardLabel';
import { canvasStyles } from './styles';

const isRelated = (board: BoardModel, selected: string | null, id: string) =>
  !!selected &&
  selected !== id &&
  !!board.journeyGroupId &&
  board.boardById[selected]?.groupId === board.journeyGroupId &&
  board.edges.some(
    (e) => (e.from === selected && e.to === id) || (e.to === selected && e.from === id),
  );

interface BoardNodeProps {
  board: ArtboardBoardView;
  k: number;
  live: boolean;
}

const BoardNode = ({ board: item, k, live }: BoardNodeProps) => {
  const board = useBoard();
  const journey = useJourneyView();
  const s = useArtboardStore((st) => ({
    flash: st.flash.includes(item.id),
    related: st.mode === 'discuss' && isRelated(board, st.selected, item.id),
    selected: st.selected === item.id,
    showReal: st.showReal,
    verify: st.mode === 'verify',
  }));

  const inJourney = !!board.journeyGroupId && item.groupId === board.journeyGroupId;
  const muted = s.verify && !inJourney;
  const state = inJourney ? nodeState(journey, item.id) : undefined;
  const border = s.verify && inJourney ? flowStateColor(state) : undefined;
  const preview = boardPreview(journey, item.id, s.verify && inJourney && s.showReal);
  const { rect, source } = item;

  return (
    <div
      data-board-item
      data-item-id={item.id}
      {...sx([canvasStyles.board, canvasStyles.appear, muted && canvasStyles.muted], undefined, {
        height: rect.h,
        left: rect.x,
        top: rect.y,
        width: rect.w,
      })}
      onClick={(e) => {
        e.stopPropagation();
        artboardActions.select(item.id);
      }}
    >
      <BoardLabel
        board={item}
        k={k}
        linked={board.finalized && inJourney}
        recommended={board.recommendedIds.has(item.id)}
        state={state}
        verify={s.verify}
      />
      <div
        {...sx(
          [
            canvasStyles.boardCard,
            s.selected && canvasStyles.boardSelected,
            !s.selected && s.related && canvasStyles.boardRelated,
            s.flash && canvasStyles.flash,
          ],
          undefined,
          border ? { borderColor: border, borderWidth: 3 } : undefined,
        )}
      >
        <BoardBody
          board={item}
          imageUrl={source?.kind === 'image' ? board.imageUrls[source.fileId] : undefined}
          live={live}
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

export default BoardNode;

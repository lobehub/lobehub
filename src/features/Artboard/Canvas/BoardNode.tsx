import type { ArtboardBoardView } from '@lobechat/types';

import { flowStateColor } from '@/features/Acceptance/Viewer/Flow/flowStateColor';
import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import type { BoardModel } from '../model';
import { artboardActions, useArtboardStore } from '../store';
import { isFlagged, nodeScreenshot, nodeState } from '../Verify/flow';
import { useBoardCapabilities } from '../Viewport/capabilities';
import BoardBody from './BoardBody';
import BoardLabel from './BoardLabel';
import CompareBody from './CompareBody';
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
  const { journey, onPick } = useBoardCapabilities();
  const s = useArtboardStore((st) => ({
    compare: st.compare,
    flash: st.flash.includes(item.id),
    related: st.mode === 'discuss' && isRelated(board, st.selected, item.id),
    selected: st.selected === item.id,
    verify: st.mode === 'verify',
  }));

  const inJourney = !!board.journeyGroupId && item.groupId === board.journeyGroupId;
  const muted = s.verify && !inJourney;
  const state = inJourney ? nodeState(journey, item.id) : undefined;
  const border = s.verify && isFlagged(state) ? flowStateColor(state) : undefined;
  const screenshotUrl = s.verify && inJourney ? nodeScreenshot(journey, item.id) : undefined;
  const compare = s.selected && screenshotUrl ? s.compare : 'real';
  const imageUrl = item.source?.kind === 'image' ? board.imageUrls[item.source.fileId] : undefined;
  const { rect } = item;
  const round = item.groupId ? board.roundByGroupId[item.groupId] : undefined;
  const option = !s.verify && round && round.id === item.roundId ? round : undefined;
  const picked = option?.chosenBoardId === item.id;

  return (
    <div
      data-board-item
      data-item-id={item.id}
      {...sx(canvasStyles.board, canvasStyles.appear, muted && canvasStyles.muted, {
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
        choice={
          option && {
            checked: picked,
            disabled: option.status !== 'open' || board.finalized || !onPick,
            onPick: () => onPick?.(option.id, item.id),
          }
        }
      />
      <div
        {...sx(
          canvasStyles.boardCard,
          picked && canvasStyles.boardPicked,
          s.selected && canvasStyles.boardSelected,
          !s.selected && s.related && canvasStyles.boardRelated,
          s.flash && canvasStyles.flash,
          border ? { borderColor: border, borderWidth: 3 } : undefined,
        )}
      >
        {compare === 'split' && screenshotUrl ? (
          <CompareBody board={item} imageUrl={imageUrl} screenshotUrl={screenshotUrl} />
        ) : (
          <BoardBody
            board={item}
            imageUrl={imageUrl}
            live={live}
            screenshotUrl={compare === 'design' ? undefined : screenshotUrl}
          />
        )}
      </div>
    </div>
  );
};

export default BoardNode;

import { useBoard } from '../BoardContext';
import { commentTargetAt } from '../data/commentActions';
import { artboardActions, useArtboardStore } from '../store';
import Viewport from '../Viewport';
import CommentLayer from './CommentLayer';
import { CompareBar, SelectionBar } from './Overlays';

const clearSelection = () => {
  artboardActions.select(null);
  const { draft, openThreadId } = useArtboardStore.getState();
  if (draft || openThreadId) artboardActions.openThread(null);
};

const Canvas = () => {
  const board = useBoard();
  const discussing = useArtboardStore((s) => s.mode === 'discuss');
  const commenting = useArtboardStore((s) => s.mode === 'discuss' && s.tool === 'comment');

  return (
    <Viewport
      commenting={commenting}
      onBackground={clearSelection}
      onCanvasClick={(event, view) => {
        if (!commenting) return;
        event.stopPropagation();
        const box = event.currentTarget.getBoundingClientRect();
        const point = {
          x: (event.clientX - box.left - view.x) / view.k,
          y: (event.clientY - box.top - view.y) / view.k,
        };
        artboardActions.placeDraft({ ...commentTargetAt(board, point), ...point });
      }}
    >
      {({ size, view }) => (
        <>
          <SelectionBar view={view} />
          <CompareBar />
          {discussing && <CommentLayer size={size} view={view} />}
        </>
      )}
    </Viewport>
  );
};

export default Canvas;

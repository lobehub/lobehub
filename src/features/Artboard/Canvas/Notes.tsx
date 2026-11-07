import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import { createResolveModal } from '../Finalize';
import { artboardActions, useArtboardStore } from '../store';
import { canvasStyles } from './styles';

const Notes = () => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const { drag, flash, verify } = useArtboardStore((s) => ({
    drag: s.drag,
    flash: s.flash,
    verify: s.mode === 'verify',
  }));

  return board.notes.map((note) => {
    const at = drag?.id === note.id ? drag : note;
    const position = { left: at.x, top: at.y };
    if (note.kind === 'title' || note.kind === 'subtitle')
      return (
        <div
          key={note.id}
          {...sx(
            [
              note.kind === 'title' ? canvasStyles.title : canvasStyles.subtitle,
              canvasStyles.appear,
            ],
            undefined,
            position,
          )}
        >
          {note.text}
        </div>
      );

    const decided = note.question?.status === 'decided' ? note.question.decision : undefined;
    const open = note.question?.status === 'open';
    return (
      <div
        data-board-item
        data-item-id={note.id}
        key={note.id}
        {...sx(
          [
            canvasStyles.sticky,
            canvasStyles.appear,
            open && canvasStyles.stickyPending,
            !!decided && canvasStyles.stickyGood,
            flash.includes(note.id) && canvasStyles.flash,
          ],
          undefined,
          { ...position, opacity: verify ? 0.3 : 1, width: note.w },
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (open) createResolveModal(board.artboard.id, note.id);
          else artboardActions.select(note.id);
        }}
      >
        {decided
          ? t('artboard.sticky.decided', { text: decided })
          : open
            ? t('artboard.sticky.pending', { text: note.text })
            : note.text}
        {open && (
          <div style={{ fontSize: 15, marginTop: 8, opacity: 0.7 }}>
            {t('artboard.sticky.action')}
          </div>
        )}
      </div>
    );
  });
};

export default Notes;

import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import { isMacOS } from '@/utils/platform';

import { useSubmitBatch } from '../Board/useSubmitBatch';
import { useBoard } from '../BoardContext';
import { addThread } from '../data/commentActions';
import { artboardActions } from '../store';
import type { CommentDraft } from '../store/initialState';
import Composer from './Composer';
import { cardStyles } from './styles';

const DraftCard = ({ draft }: { draft: CommentDraft }) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const submitBatch = useSubmitBatch();
  const artboardId = board.artboard.id;
  const { x: _x, y: _y, ...target } = draft;
  const place =
    (target.boardId && board.boardById[target.boardId]?.title) ||
    (target.groupId && board.groups.find((group) => group.id === target.groupId)?.title) ||
    t('artboard.comment.onCanvas');

  return (
    <div {...stylex.props(cardStyles.card)}>
      <div {...stylex.props(cardStyles.head)}>
        <span {...stylex.props(cardStyles.label)}>{place}</span>
      </div>
      <Composer
        autoFocus
        action={t('artboard.comment.send')}
        hint={t('artboard.comment.sendHint', { mod: isMacOS() ? '⌘' : 'Ctrl' })}
        nowAction={t('artboard.comment.sendNow')}
        placeholder={t('artboard.comment.placeholder')}
        onSend={async (text, now) => {
          const thread = await addThread(artboardId, target, text);
          artboardActions.openThread(thread.id);
          if (now) await submitBatch([]);
        }}
      />
    </div>
  );
};

export default DraftCard;

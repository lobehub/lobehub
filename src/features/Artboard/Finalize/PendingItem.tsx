import { Button, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import { focusComposer } from '../Board/focusComposer';
import type { BoardBlocker } from '../model';
import { artboardActions } from '../store';

const styles = stylex.create({
  item: {
    backgroundColor: cssVar.colorWarningBg,
    borderColor: cssVar.colorWarningBorder,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    padding: 12,
  },
});

interface PendingItemProps {
  blocker: BoardBlocker;
  onDiscuss?: () => void;
}

const PendingItem = ({ blocker, onDiscuss }: PendingItemProps) => {
  const { t } = useTranslation('project');
  const boardId = blocker.kind === 'question' ? blocker.boardId : null;

  const discuss = () => {
    if (!boardId) return;
    onDiscuss?.();
    artboardActions.setMode('discuss');
    artboardActions.focusItem(boardId);
    focusComposer();
  };

  return (
    <Flexbox gap={8} {...stylex.props(styles.item)}>
      <Text strong>{blocker.text}</Text>
      <Text style={{ fontSize: 13 }} type="secondary">
        {t(
          blocker.kind === 'round'
            ? 'artboard.finalize.pending.round'
            : 'artboard.finalize.pending.question',
        )}
      </Text>
      {boardId && (
        <Flexbox horizontal gap={8}>
          <Button size={'small'} onClick={discuss}>
            {t('artboard.finalize.pending.discuss')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default PendingItem;

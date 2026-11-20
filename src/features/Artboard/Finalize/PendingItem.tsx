import { Button, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

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

const copyOf = (blocker: BoardBlocker) => {
  if (blocker.kind === 'round')
    return {
      action: 'artboard.finalize.pending.goChoose',
      note: 'artboard.finalize.pending.round',
    } as const;
  if (blocker.answered)
    return {
      action: 'artboard.finalize.pending.view',
      note: 'artboard.finalize.pending.answered',
    } as const;
  return {
    action: 'artboard.finalize.pending.goAnswer',
    note: 'artboard.finalize.pending.question',
  } as const;
};

interface PendingItemProps {
  blocker: BoardBlocker;
  onDiscuss?: () => void;
}

const PendingItem = ({ blocker, onDiscuss }: PendingItemProps) => {
  const { t } = useTranslation('project');
  const copy = copyOf(blocker);
  const jump = () => {
    onDiscuss?.();
    if (blocker.kind === 'question')
      return artboardActions.showThread({
        boardId: blocker.boardId,
        id: blocker.id,
        pageId: blocker.pageId,
      });
    if (blocker.groupId)
      artboardActions.goTo({ id: blocker.groupId, kind: 'group', pageId: blocker.pageId });
    else artboardActions.setPage(blocker.pageId);
  };

  return (
    <Flexbox gap={8} {...stylex.props(styles.item)}>
      <Text strong>{blocker.text}</Text>
      <Text style={{ fontSize: 13 }} type="secondary">
        {t(copy.note)}
      </Text>
      <Flexbox horizontal gap={8}>
        <Button size={'small'} onClick={jump}>
          {t(copy.action)}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

export default PendingItem;

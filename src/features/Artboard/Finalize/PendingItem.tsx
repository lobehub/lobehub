import { Button, Flexbox, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { focusComposer } from '../Board/focusComposer';
import { decideQuestion } from '../data/actions';
import { addBoardReference } from '../data/addBoardReference';
import { boardReference } from '../data/references';
import { useBoardModel } from '../data/useBoardModel';
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
  resolved: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderColor: cssVar.colorBorderSecondary,
  },
});

interface PendingItemProps {
  artboardId: string;
  noteId: string;
  onDiscuss?: () => void;
  onResolved?: () => void;
}

const PendingItem = ({ artboardId, noteId, onDiscuss, onResolved }: PendingItemProps) => {
  const { t } = useTranslation('project');
  const board = useBoardModel(artboardId);
  const [saving, setSaving] = useState(false);
  const note = board?.noteById[noteId];
  if (!board || !note?.question) return null;

  const { question } = note;
  const decided = question.status === 'decided' ? question.decision : undefined;
  const decide = async (decision: string) => {
    setSaving(true);
    try {
      await decideQuestion(artboardId, board.artboard.revision, noteId, decision);
      const reference = boardReference(board, noteId, 'decision', decision);
      if (reference) addBoardReference(reference);
      onResolved?.();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const discuss = () => {
    onDiscuss?.();
    artboardActions.setMode('discuss');
    artboardActions.select(noteId);
    focusComposer();
  };

  return (
    <Flexbox gap={8} {...stylex.props(styles.item, !!decided && styles.resolved)}>
      <Text strong>{note.text}</Text>
      {decided ? (
        <Text style={{ fontSize: 13 }} type="success">
          {t('artboard.chat.decided', { text: decided })}
        </Text>
      ) : (
        question.suggestion && (
          <>
            <Text style={{ fontSize: 13 }} type="secondary">
              {t('artboard.resolve.suggest', { text: question.suggestion })}
            </Text>
            <Flexbox horizontal gap={8}>
              <Button
                loading={saving}
                size={'small'}
                type={'primary'}
                onClick={() => decide(question.suggestion!)}
              >
                {t('artboard.resolve.accept')}
              </Button>
              <Button size={'small'} onClick={discuss}>
                {t('artboard.resolve.discuss')}
              </Button>
            </Flexbox>
          </>
        )
      )}
      {!decided && !question.suggestion && (
        <Flexbox horizontal gap={8}>
          <Button size={'small'} onClick={discuss}>
            {t('artboard.resolve.discuss')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default PendingItem;

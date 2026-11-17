import { Button, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { SendIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBoard } from '../BoardContext';
import { pendingThreads, summarizeRounds } from '../data/submitBatch';
import { useArtboardComments } from '../data/useArtboardComments';
import { artboardActions } from '../store';
import { floatStyles } from '../Viewport/floatStyles';
import { useSubmitBatch } from './useSubmitBatch';

const styles = stylex.create({
  bar: {
    insetBlockEnd: 'calc(12px + env(safe-area-inset-bottom, 0px))',
    insetInlineStart: '50%',
    maxWidth: 'calc(100% - 320px)',
    paddingBlock: 6,
    paddingInlineEnd: 6,
    paddingInlineStart: 16,
    transform: 'translateX(-50%)',
    whiteSpace: 'nowrap',
  },
  raised: {
    insetBlockEnd: 'calc(60px + env(safe-area-inset-bottom, 0px))',
    maxWidth: 'calc(100% - 24px)',
  },
  status: {
    fontSize: 12,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  title: {
    flex: 'none',
  },
  undecided: {
    cursor: 'pointer',
    textDecorationLine: 'underline',
  },
});

const SubmitBar = ({ narrow }: { narrow: boolean }) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const submitBatch = useSubmitBatch();
  const { data: threads } = useArtboardComments(board.artboard.id);
  const [submitting, setSubmitting] = useState(false);
  const summary = useMemo(() => summarizeRounds(board.openRounds), [board.openRounds]);
  const comments = useMemo(() => pendingThreads(board, threads ?? []).length, [board, threads]);
  if (!summary.total && !comments) return null;

  const submit = async () => {
    setSubmitting(true);
    try {
      await submitBatch(board.openRounds.map((round) => round.id));
    } finally {
      setSubmitting(false);
    }
  };

  const showUndecided = () => {
    const round = board.openRounds.find((item) => item.id === summary.firstUndecidedId);
    const groupId = Object.keys(board.roundByGroupId).find(
      (id) => board.roundByGroupId[id].id === round?.id,
    );
    if (round && groupId)
      artboardActions.goTo({ id: groupId, kind: 'group', pageId: round.pageId });
  };

  return (
    <Flexbox
      horizontal
      align="center"
      gap={12}
      {...stylex.props(floatStyles.float, styles.bar, narrow && styles.raised)}
    >
      <Text strong {...stylex.props(styles.title)}>
        {summary.total
          ? t('artboard.submit.title', { count: summary.total })
          : t('artboard.submit.commentsTitle', { count: comments })}
      </Text>
      {!summary.total ? null : summary.undecided > 0 ? (
        <Text type="warning" {...stylex.props(styles.undecided)} onClick={showUndecided}>
          {t('artboard.submit.undecided', { count: summary.undecided })}
        </Text>
      ) : (
        <Text type="secondary" {...stylex.props(styles.status)}>
          {summary.byRecommendation
            ? t('artboard.submit.status', {
                picked: summary.picked,
                rest: summary.byRecommendation,
              })
            : t('artboard.submit.allPicked', { picked: summary.picked })}
          {comments > 0 && ` · ${t('artboard.submit.comments', { count: comments })}`}
        </Text>
      )}
      <Button
        disabled={summary.undecided > 0}
        icon={SendIcon}
        loading={submitting}
        size={'small'}
        type={'primary'}
        onClick={submit}
      >
        {t('artboard.submit.action')}
      </Button>
    </Flexbox>
  );
};

export default SubmitBar;

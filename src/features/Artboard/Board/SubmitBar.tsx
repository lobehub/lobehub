import { Button, Flexbox, Text, toast } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { SendIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBoard } from '../BoardContext';
import { floatStyles } from '../Canvas/Overlays';
import { sendToBoardConversation } from '../data/boardConversation';
import { submitBoardRounds, summarizeRounds } from '../data/submitRounds';
import { artboardActions } from '../store';

const styles = stylex.create({
  bar: {
    insetBlockEnd: 'calc(12px + env(safe-area-inset-bottom, 0px))',
    insetInlineStart: '50%',
    maxWidth: 'calc(100% - 24px)',
    paddingBlock: 6,
    paddingInlineEnd: 6,
    paddingInlineStart: 16,
    transform: 'translateX(-50%)',
    whiteSpace: 'nowrap',
  },
  raised: {
    insetBlockEnd: 'calc(60px + env(safe-area-inset-bottom, 0px))',
  },
  undecided: {
    cursor: 'pointer',
    textDecorationLine: 'underline',
  },
});

const SubmitBar = ({ narrow }: { narrow: boolean }) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const [submitting, setSubmitting] = useState(false);
  const summary = useMemo(() => summarizeRounds(board.openRounds), [board.openRounds]);
  if (!summary.total || board.finalized) return null;

  const { artboard } = board;
  const resend = (message: string) =>
    sendToBoardConversation(artboard.topicId, message).catch(() => notifyFailed(message));
  const notifyFailed = (message: string) =>
    toast.error({
      actions: [{ label: t('artboard.submit.resend'), onClick: () => void resend(message) }],
      title: t('artboard.submit.messageFailed'),
    });

  const submit = async () => {
    setSubmitting(true);
    try {
      const { message, status } = await submitBoardRounds(artboard, (count) =>
        [
          t('artboard.submit.message', { count }),
          `> artboard ${artboard.id} · ${artboard.title}`,
        ].join('\n\n'),
      );
      if (status === 'noConversation') toast.info(t('artboard.submit.noConversation'));
      if (status === 'messageFailed') notifyFailed(message);
    } catch (error) {
      toast.error({
        description: (error as Error).message,
        title: t('artboard.submit.failed'),
      });
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
      <Text strong>{t('artboard.submit.title', { count: summary.total })}</Text>
      {summary.undecided > 0 ? (
        <Text type="warning" {...stylex.props(styles.undecided)} onClick={showUndecided}>
          {t('artboard.submit.undecided', { count: summary.undecided })}
        </Text>
      ) : (
        <Text style={{ fontSize: 12 }} type="secondary">
          {summary.byRecommendation
            ? t('artboard.submit.status', {
                picked: summary.picked,
                rest: summary.byRecommendation,
              })
            : t('artboard.submit.allPicked', { picked: summary.picked })}
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

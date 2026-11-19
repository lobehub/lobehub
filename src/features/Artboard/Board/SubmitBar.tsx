import { Button, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBoard } from '../BoardContext';
import { pendingThreads, summarizeRounds } from '../data/submitBatch';
import { useArtboardComments } from '../data/useArtboardComments';
import { artboardActions } from '../store';
import { artboardTokens } from '../tokens.stylex';
import { useSubmitBatch } from './useSubmitBatch';

const styles = stylex.create({
  bar: {
    alignItems: 'center',
    backgroundColor: cssVar.colorBgElevated,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 999,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: artboardTokens.overlayShadow,
    display: 'flex',
    fontSize: 13,
    gap: 12,
    height: 44,
    insetBlockEnd: 'calc(12px + env(safe-area-inset-bottom, 0px))',
    insetInlineStart: '50%',
    lineHeight: 1,
    maxWidth: 'calc(100% - 248px)',
    paddingInlineEnd: 6,
    paddingInlineStart: 20,
    position: 'absolute',
    transform: 'translateX(-50%)',
    whiteSpace: 'nowrap',
    zIndex: 10,
  },
  raised: {
    insetBlockEnd: 'calc(64px + env(safe-area-inset-bottom, 0px))',
    maxWidth: 'calc(100% - 24px)',
  },
  title: {
    color: cssVar.colorText,
    flexShrink: 0,
    fontWeight: 500,
    maxWidth: 220,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  muted: {
    color: cssVar.colorTextSecondary,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  undecided: {
    color: {
      ':hover': cssVar.colorWarningTextHover,
      'default': cssVar.colorWarningText,
    },
    cursor: 'pointer',
    textDecorationLine: 'underline',
    textUnderlineOffset: 3,
  },
  rule: {
    backgroundColor: cssVar.colorBorderSecondary,
    flex: 'none',
    height: 16,
    width: 1,
  },
  primary: {
    fontWeight: 500,
    height: 32,
    paddingInline: 14,
  },
});

const SubmitBar = ({ narrow }: { narrow: boolean }) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const submitBatch = useSubmitBatch();
  const { data: threads } = useArtboardComments(board.artboard.id);
  const [submitting, setSubmitting] = useState(false);
  const summary = useMemo(() => summarizeRounds(board.openRounds), [board.openRounds]);
  const comments = useMemo(() => pendingThreads(threads ?? []).length, [threads]);
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

  const parts: { key: string; node: ReactNode }[] = [];
  if (summary.total && summary.undecided > 0)
    parts.push({
      key: 'undecided',
      node: (
        <span
          role={'button'}
          tabIndex={0}
          {...stylex.props(styles.undecided)}
          onClick={showUndecided}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') showUndecided();
          }}
        >
          {t('artboard.submit.undecided', { count: summary.undecided })}
        </span>
      ),
    });
  else if (summary.total)
    parts.push({
      key: 'picked',
      node: summary.byRecommendation
        ? t('artboard.submit.status', { picked: summary.picked, rest: summary.byRecommendation })
        : t('artboard.submit.allPicked', { picked: summary.picked }),
    });
  if (summary.total && comments > 0)
    parts.push({ key: 'comments', node: t('artboard.submit.comments', { count: comments }) });

  return (
    <Flexbox horizontal {...stylex.props(styles.bar, narrow && styles.raised)}>
      <span {...stylex.props(styles.title)}>
        {summary.total
          ? t('artboard.submit.title', { count: summary.total })
          : t('artboard.submit.commentsTitle', { count: comments })}
      </span>
      {parts.length > 0 && (
        <span {...stylex.props(styles.muted)}>
          {parts.map((part, index) => (
            <Fragment key={part.key}>
              {index > 0 && ' · '}
              {part.node}
            </Fragment>
          ))}
        </span>
      )}
      <span {...stylex.props(styles.rule)} />
      <Button
        disabled={summary.undecided > 0}
        loading={submitting}
        shape={'round'}
        type={'primary'}
        {...stylex.props(styles.primary)}
        onClick={submit}
      >
        {t('artboard.submit.action')}
      </Button>
    </Flexbox>
  );
};

export default SubmitBar;

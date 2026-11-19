import type { ArtboardCommentThreadView } from '@lobechat/types';
import { ActionIcon, Tag, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSubmitBatch } from '../Board/useSubmitBatch';
import { useBoard } from '../BoardContext';
import { replyThread, settleThread } from '../data/commentActions';
import { isAnswered, isQuestion, threadPlace } from '../data/commentModel';
import { artboardTokens } from '../tokens.stylex';
import Composer from './Composer';
import Message from './Message';
import { cardStyles } from './styles';

const ICON_SIZE = { blockSize: 22, size: 13 };

const styles = stylex.create({
  badge: {
    borderRadius: 999,
    flexShrink: 0,
    fontSize: 10,
    height: 'auto',
    lineHeight: 1.6,
    marginInlineEnd: 0,
    paddingBlock: 1,
    paddingInline: 8,
  },
  info: {
    backgroundColor: cssVar.colorInfoBg,
    color: cssVar.colorInfoText,
  },
  messages: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    paddingBlock: 10,
    paddingInline: 14,
  },
  neutral: {
    backgroundColor: cssVar.colorFillTertiary,
    color: cssVar.colorTextSecondary,
  },
  stale: {
    color: artboardTokens.stale,
  },
  tools: {
    display: 'flex',
    flexShrink: 0,
    gap: 2,
    marginInlineStart: -4,
  },
  warning: {
    backgroundColor: cssVar.colorWarningBg,
    color: cssVar.colorWarningText,
  },
});

type BadgeTone = 'info' | 'neutral' | 'warning';

const StateTag = ({ children, tone }: { children: string; tone: BadgeTone }) => (
  <Tag
    shape="round"
    size="small"
    variant="borderless"
    {...stylex.props(styles.badge, styles[tone])}
  >
    {children}
  </Tag>
);

interface ThreadCardProps {
  number?: number;
  onClose: () => void;
  thread: ArtboardCommentThreadView;
}

const ThreadCard = ({ number, onClose, thread }: ThreadCardProps) => {
  const { t } = useTranslation(['project', 'common']);
  const board = useBoard();
  const artboardId = board.artboard.id;
  const [settling, setSettling] = useState(false);
  const submitBatch = useSubmitBatch();
  const question = isQuestion(thread);
  const answered = question && isAnswered(thread);
  const resolved = !!thread.resolvedAt;
  const place = threadPlace(thread, board);
  const placeTitle = place.kind === 'canvas' ? t('artboard.comment.onCanvas') : place.title;

  const settle = async (next: boolean) => {
    setSettling(true);
    try {
      await settleThread(artboardId, thread.id, next);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSettling(false);
    }
  };

  const resolveLabel = t('artboard.comment.resolve');
  const reopenLabel = t('artboard.comment.reopen');
  const closeLabel = t('close', { ns: 'common' });

  return (
    <div {...stylex.props(cardStyles.card)}>
      <div {...stylex.props(cardStyles.head)}>
        <span {...stylex.props(cardStyles.label)}>
          {number ? `#${number} · ` : ''}
          {placeTitle}
          {thread.stale && (
            <span {...stylex.props(styles.stale)}> · {t('artboard.comment.stale')}</span>
          )}
        </span>
        {thread.unread && <StateTag tone="info">{t('artboard.comment.unread')}</StateTag>}
        {!resolved && question && (
          <StateTag tone={answered ? 'neutral' : 'warning'}>
            {t(answered ? 'artboard.question.answered' : 'artboard.question.waiting')}
          </StateTag>
        )}
        {resolved && <StateTag tone="neutral">{t('artboard.comment.resolved')}</StateTag>}
        <span {...stylex.props(styles.tools)}>
          {resolved ? (
            <ActionIcon
              aria-label={reopenLabel}
              icon={RotateCcwIcon}
              loading={settling}
              size={ICON_SIZE}
              title={reopenLabel}
              onClick={() => settle(false)}
            />
          ) : (
            (!question || answered) && (
              <ActionIcon
                aria-label={resolveLabel}
                icon={CheckIcon}
                loading={settling}
                size={ICON_SIZE}
                title={resolveLabel}
                onClick={() => settle(true)}
              />
            )
          )}
          <ActionIcon
            aria-label={closeLabel}
            icon={XIcon}
            size={ICON_SIZE}
            title={closeLabel}
            onClick={onClose}
          />
        </span>
      </div>
      <div {...stylex.props(styles.messages)}>
        <Message comment={thread} />
        {(thread.replies ?? []).map((reply) => (
          <Message comment={reply} key={reply.id} />
        ))}
      </div>
      {!resolved && (
        <Composer
          action={t(question ? 'artboard.question.answer' : 'artboard.comment.send')}
          hint={question ? t('artboard.question.hint') : undefined}
          nowAction={t('artboard.comment.sendNow')}
          placeholder={t(question ? 'artboard.question.placeholder' : 'artboard.comment.reply')}
          onSend={async (text, now) => {
            await replyThread(artboardId, thread.id, text);
            if (now) await submitBatch([]);
          }}
        />
      )}
    </div>
  );
};

export default ThreadCard;

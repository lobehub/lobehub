import type { ArtboardCommentThreadView, ArtboardCommentView } from '@lobechat/types';
import { Button, Flexbox, Icon, Tag, Text, TextArea, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BotIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useBoard } from '../BoardContext';
import { addThread, replyThread, settleThread } from '../data/commentActions';
import { isAnswered, isQuestion, threadPlace } from '../data/commentModel';
import { artboardActions } from '../store';
import type { CommentDraft } from '../store/initialState';

const styles = stylex.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: cssVar.colorFillSecondary,
    borderRadius: '50%',
    display: 'flex',
    flex: 'none',
    fontSize: 12,
    fontWeight: 600,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  avatarAgent: {
    backgroundColor: cssVar.colorWarningBg,
    color: cssVar.colorWarningText,
  },
  body: {
    fontSize: 14,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  footer: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    paddingBlock: 8,
    paddingInline: 12,
  },
  messages: {
    maxHeight: 240,
    overflowY: 'auto',
    paddingBlock: 4,
    paddingInline: 12,
  },
});

const timeOf = (value: Date | string) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const Message = ({ comment }: { comment: ArtboardCommentView }) => {
  const { t } = useTranslation('project');
  const me = useUserStore(userProfileSelectors.userId);
  const agent = !!comment.authorAgentId;
  const name = agent
    ? t('artboard.comment.agent')
    : comment.authorUserId === me
      ? t('artboard.comment.you')
      : t('artboard.comment.member');

  return (
    <Flexbox horizontal gap={8} paddingBlock={4}>
      <div {...stylex.props(styles.avatar, agent && styles.avatarAgent)}>
        {agent ? <Icon icon={BotIcon} size={14} /> : name.slice(0, 1)}
      </div>
      <Flexbox gap={2} style={{ minWidth: 0 }}>
        <Flexbox horizontal align="center" gap={8}>
          <Text strong style={{ fontSize: 12 }}>
            {name}
          </Text>
          <Text style={{ fontSize: 12 }} type="secondary">
            {timeOf(comment.createdAt)}
          </Text>
        </Flexbox>
        <div {...stylex.props(styles.body)}>{comment.content}</div>
      </Flexbox>
    </Flexbox>
  );
};

interface ReplyBoxProps {
  action: string;
  autoFocus?: boolean;
  extra?: React.ReactNode;
  onSend: (text: string) => Promise<unknown>;
  placeholder: string;
  primary?: boolean;
}

const ReplyBox = ({ action, autoFocus, extra, onSend, placeholder, primary }: ReplyBoxProps) => {
  const { t } = useTranslation('project');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      await onSend(content);
      setText('');
    } catch (error) {
      toast.error({
        description: (error as Error).message,
        title: t('artboard.comment.failed'),
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Flexbox horizontal align="flex-end" gap={8}>
      <TextArea
        autoFocus={autoFocus}
        autoSize={{ maxRows: 4, minRows: 1 }}
        placeholder={placeholder}
        style={{ flex: 1 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <Button
        disabled={!text.trim()}
        loading={sending}
        size={'small'}
        type={primary ? 'primary' : 'default'}
        onClick={send}
      >
        {action}
      </Button>
      {extra}
    </Flexbox>
  );
};

export const ThreadCard = ({ thread }: { thread: ArtboardCommentThreadView }) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const artboardId = board.artboard.id;
  const [settling, setSettling] = useState(false);
  const question = isQuestion(thread);
  const resolved = !!thread.resolvedAt;
  const place = threadPlace(thread, board);

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

  return (
    <Flexbox>
      <Flexbox horizontal align="center" gap={8} padding={12} paddingBlock={'12px 4px'} wrap="wrap">
        <Text ellipsis strong style={{ fontSize: 12, maxWidth: 160 }}>
          {place.kind === 'canvas' ? t('artboard.comment.onCanvas') : place.title}
        </Text>
        {thread.stale && <Tag size={'small'}>{t('artboard.comment.stale')}</Tag>}
        <div style={{ flex: 1 }} />
        {resolved && <Tag size={'small'}>{t('artboard.comment.resolved')}</Tag>}
        {!resolved && question && (
          <Tag color={isAnswered(thread) ? undefined : 'warning'} size={'small'}>
            {t(isAnswered(thread) ? 'artboard.question.answered' : 'artboard.question.waiting')}
          </Tag>
        )}
        {thread.unread && (
          <Tag color={'info'} size={'small'}>
            {t('artboard.comment.unread')}
          </Tag>
        )}
      </Flexbox>
      <div {...stylex.props(styles.messages)}>
        <Message comment={thread} />
        {thread.replies.map((reply) => (
          <Message comment={reply} key={reply.id} />
        ))}
      </div>
      <Flexbox gap={6} {...stylex.props(styles.footer)}>
        {resolved ? (
          <Flexbox horizontal justify="flex-end">
            <Button loading={settling} size={'small'} onClick={() => settle(false)}>
              {t('artboard.comment.reopen')}
            </Button>
          </Flexbox>
        ) : (
          <ReplyBox
            action={t(question ? 'artboard.question.answer' : 'artboard.comment.send')}
            placeholder={t(question ? 'artboard.question.placeholder' : 'artboard.comment.reply')}
            primary={question && !isAnswered(thread)}
            extra={
              <Button loading={settling} size={'small'} onClick={() => settle(true)}>
                {t('artboard.comment.resolve')}
              </Button>
            }
            onSend={(text) => replyThread(artboardId, thread.id, text)}
          />
        )}
        {question && !resolved && (
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('artboard.question.hint')}
          </Text>
        )}
      </Flexbox>
    </Flexbox>
  );
};

export const DraftCard = ({ draft }: { draft: CommentDraft }) => {
  const { t } = useTranslation('project');
  const artboardId = useBoard().artboard.id;
  const { x: _x, y: _y, ...target } = draft;

  return (
    <Flexbox padding={12}>
      <ReplyBox
        autoFocus
        primary
        action={t('artboard.comment.send')}
        placeholder={t('artboard.comment.placeholder')}
        onSend={async (text) => {
          const thread = await addThread(artboardId, target, text);
          artboardActions.openThread(thread.id);
        }}
      />
    </Flexbox>
  );
};

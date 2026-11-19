import { Flexbox, type MarkdownProps } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronRight, MessagesSquare, Reply } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MarkdownMessage from '@/features/Conversation/Markdown';
import type { ChannelPrompt, ChannelPromptMessage } from '@/store/chat/utils/parseChannelPrompt';

import ReferencedMessage from './ReferencedMessage';

const styles = stylex.create({
  context: {
    overflow: 'hidden',
    borderRadius: '6px',
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  meta: { fontSize: '12px', color: cssVar.colorTextTertiary },
  name: { flexShrink: 0, fontWeight: 500, color: cssVar.colorText },
  note: { color: cssVar.colorTextTertiary, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
  rows: {
    paddingBlockEnd: '8px',
    paddingInline: '10px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    paddingBlockStart: '8px',
  },
  tag: {
    paddingInline: '4px',
    borderRadius: '4px',
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorFillSecondary,
  },
  text: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '4',
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  toggle: {
    cursor: 'pointer',
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    width: '100%',
    paddingBlock: '6px',
    paddingInline: '10px',
    borderWidth: 0,
    font: 'inherit',
    color: 'inherit',
    textAlign: 'start',
    backgroundColor: 'transparent',
  },
});

const ContextRow = memo<{ message: ChannelPromptMessage }>(({ message }) => {
  const { t } = useTranslation('chat');
  return (
    <Flexbox gap={2}>
      <Flexbox horizontal align={'center'} gap={6}>
        <span {...stylex.props(styles.name)}>{message.from}</span>
        {message.type === 'agent' && (
          <span {...stylex.props(styles.tag)}>
            {message.self ? t('messages.channelPrompt.self') : t('messages.channelPrompt.agent')}
          </span>
        )}
      </Flexbox>
      <div {...stylex.props(styles.text)}>{message.content}</div>
    </Flexbox>
  );
});

ContextRow.displayName = 'ChannelPromptContextRow';

/** The unseen Channel messages the run was handed, folded away so the request leads. */
const ChannelContext = memo<{ prompt: ChannelPrompt }>(({ prompt }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const { omitted, recent, notes } = prompt;
  if (recent.length === 0 && omitted === 0 && notes.length === 0) return null;

  const summary = [
    t('messages.channelPrompt.context', { count: recent.length }),
    omitted > 0 ? t('messages.channelPrompt.omitted', { count: omitted }) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div {...stylex.props(styles.context)} data-testid="channel-prompt-context">
      <button
        type={'button'}
        {...stylex.props(styles.toggle)}
        onClick={() => setOpen((value) => !value)}
      >
        <MessagesSquare size={12} />
        <span>{summary}</span>
        <Chevron size={12} />
      </button>
      {open && (
        <Flexbox className={stylex.props(styles.rows).className} gap={10}>
          {recent.map((message, index) => (
            <ContextRow key={index} message={message} />
          ))}
          {notes.map((note, index) => (
            <div key={`note-${index}`} {...stylex.props(styles.note)}>
              {note}
            </div>
          ))}
        </Flexbox>
      )}
    </div>
  );
});

ChannelContext.displayName = 'ChannelPromptContext';

/**
 * A Channel run's user message, rendered as the request it answers instead of the raw
 * `<channel_*>` prompt markup: the context folded above, the quote as a quote, the request as
 * the message body, and the acknowledgement already posted as a footnote.
 */
const ChannelPromptContent = memo<{ markdownProps: Partial<MarkdownProps>; prompt: ChannelPrompt }>(
  ({ markdownProps, prompt }) => {
    const { t } = useTranslation('chat');
    const { opening, quote, reply, request } = prompt;

    return (
      <Flexbox gap={8}>
        <ChannelContext prompt={prompt} />
        {quote && <ReferencedMessage reference={{ sender: quote.from, text: quote.content }} />}
        {request.content && <MarkdownMessage {...markdownProps}>{request.content}</MarkdownMessage>}
        {reply && (
          <ReferencedMessage
            reference={{
              sender: t('messages.channelPrompt.reply', { name: reply.from }),
              text: reply.content,
            }}
          />
        )}
        {opening && (
          <Flexbox horizontal align={'center'} gap={4} {...stylex.props(styles.meta)}>
            <Reply size={12} />
            <span>{t('messages.channelPrompt.opening', { content: opening })}</span>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

ChannelPromptContent.displayName = 'UserMessageChannelPromptContent';

export default ChannelPromptContent;

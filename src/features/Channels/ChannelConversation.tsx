import type { ChannelPublicMessage } from '@lobechat/types';
import { Button, Empty, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { MessageSquare } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import AsyncError from '@/components/AsyncError';
import { createStore, Provider } from '@/features/Conversation/store';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { cacheScope } from '@/libs/replica';
import { channelService } from '@/services/channel';
import { channelActions, channelSelectors, useChannelStore } from '@/store/channel';

import { ArchivedNotice } from './ArchivedNotice';
import { visibleChannelDetail } from './channelAccess';
import { ChannelMessage, ThreadRootMessage } from './ChannelMessage';
import { Composer } from './Composer';
import { JoinEventLine } from './JoinEventLine';
import { channelJoinEvents, channelTimeline } from './joinEvents';
import { channelTimeFormatters, presentChannelTimeline } from './messagePresentation';
import { ReplyActivity } from './ReplyActivity';
import { styles } from './styles';
import type { ChannelThreadDraft } from './threadDraft';
import { useChannelEvents } from './useChannelEvents';
import { channelDraftKey } from './useComposerDraft';
import { type ChannelReplyTarget, useReplyTarget } from './useReplyTarget';

interface ChannelConversationProps {
  channelId: string;
  /** Mounted beside a thread panel that covers it, so keep it out of the tab order. */
  inert?: boolean;
  onOpenThread?: (threadId: string, toggle?: boolean) => void;
  onStartThread?: (draft: ChannelThreadDraft) => void;
  threadId?: string | null;
}

const Timeline = ({
  channelId,
  inert,
  threadId = null,
  onOpenThread,
  onStartThread,
}: ChannelConversationProps) => {
  const { t, i18n } = useTranslation('channel');
  const timeFormats = useMemo(() => channelTimeFormatters(i18n.language), [i18n.language]);
  const [before, setBefore] = useState<number>();
  const reply = useReplyTarget(channelDraftKey(channelId, threadId));
  const [jumpTarget, setJumpTarget] = useState<ChannelReplyTarget | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const sending = useRef(false);
  const mounted = useRef(false);
  const location = useActiveLocation();
  const currentLocation = useRef(location);
  currentLocation.current = location;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(null), 1600);
    return () => clearTimeout(timer);
  }, [highlighted]);
  const params = { before, channelId, threadId };
  const sync = channelActions.useFetchDetail(params);
  const cached = useChannelStore(channelSelectors.detail(params));
  const detail = visibleChannelDetail(cached, sync.error);
  const feedRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const lastMessageId = detail?.messages.at(-1)?.id;
  const sequence = detail?.channel.sequence;
  useChannelEvents(params);
  const jumpToMessage = (target: ChannelReplyTarget) => {
    followLatest.current = false;
    setJumpTarget(target);
    if (!feedRef.current?.querySelector(`[data-message-id="${target.id}"]`))
      setBefore(target.sequence + 1);
  };
  useEffect(() => {
    if (!jumpTarget) return;
    const node = feedRef.current?.querySelector(`[data-message-id="${jumpTarget.id}"]`);
    if (!node) return;
    node.scrollIntoView({ block: 'center' });
    setHighlighted(jumpTarget.id);
    setJumpTarget(null);
  }, [detail, jumpTarget]);

  useEffect(() => {
    const feed = feedRef.current;
    if (feed && followLatest.current && before === undefined) feed.scrollTop = feed.scrollHeight;
  }, [lastMessageId, before]);

  useEffect(() => {
    if (threadId || sequence === undefined || before !== undefined) return;
    void channelService
      .markRead(channelId, sequence)
      .catch((error: unknown) => console.error('Failed to mark Channel read', error));
  }, [channelId, threadId, sequence, before]);

  const activeMembers = detail?.members.filter((member) => member.status === 'active') ?? [];
  const thread = threadId ? detail?.threads.find((entry) => entry.id === threadId) : undefined;
  const selectReply = (message: ChannelPublicMessage) => {
    if (!sending.current) reply.select(message);
  };
  const channelArchived = detail?.channel.status === 'archived';
  // Join lines belong to the main conversation; a thread starts from its root message.
  const timeline = detail
    ? channelTimeline(
        detail.messages,
        threadId ? [] : channelJoinEvents(detail.members),
        !detail.hasMore && before === undefined,
      )
    : [];

  return (
    <Flexbox
      data-channel-conversation={threadId || 'main'}
      inert={inert}
      {...stylex.props(styles.body)}
    >
      <AsyncBoundary
        data={detail}
        error={sync.error}
        errorVariant="page"
        isLoading={!detail && !sync.error}
        onRetry={() => void channelActions.refreshDetail(params)}
      >
        {detail && (
          <>
            {!!sync.error && (
              <AsyncError
                error={sync.error}
                variant="inline"
                onRetry={() => void channelActions.refreshDetail(params)}
              />
            )}
            <Flexbox
              aria-label={t(threadId ? 'thread' : 'main')}
              justify={!threadId && !timeline.length ? 'center' : undefined}
              ref={feedRef}
              onScroll={(event) => {
                const feed = event.currentTarget;
                followLatest.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 64;
              }}
              {...stylex.props(styles.feed)}
            >
              <WideScreenContainer fullWidth paddingInline={24}>
                {(detail.hasMore || before !== undefined) && (
                  <Flexbox horizontal align="center" gap={8} justify="center" paddingBlock={8}>
                    <Button
                      disabled={!detail.hasMore}
                      size="small"
                      onClick={() => setBefore(detail.messages[0]?.sequence)}
                    >
                      {t('olderMessages')}
                    </Button>
                    {before !== undefined && (
                      <Button
                        size="small"
                        type="text"
                        onClick={() => {
                          followLatest.current = true;
                          setBefore(undefined);
                        }}
                      >
                        {t('latestMessages')}
                      </Button>
                    )}
                  </Flexbox>
                )}
                {detail.rootMessage && (
                  <ThreadRootMessage
                    detail={detail}
                    highlighted={highlighted === detail.rootMessage.id}
                    root={detail.rootMessage}
                    onReply={
                      channelArchived || thread?.status === 'archived' ? undefined : selectReply
                    }
                  />
                )}
                {!timeline.length &&
                  (threadId ? (
                    <p {...stylex.props(styles.muted)}>{t('threadEmpty')}</p>
                  ) : (
                    <Empty icon={MessageSquare} title={t('conversationEmpty')} />
                  ))}
                {presentChannelTimeline(timeline).map(({ item, date, startsDay, continuation }) => (
                  <Fragment key={item.kind === 'event' ? item.event.id : item.message.id}>
                    {startsDay && (
                      <div
                        aria-label={timeFormats.date.format(date)}
                        role="separator"
                        {...stylex.props(styles.dateDivider)}
                      >
                        <span {...stylex.props(styles.dateLine)} />
                        <time dateTime={date.toISOString()}>{timeFormats.date.format(date)}</time>
                        <span {...stylex.props(styles.dateLine)} />
                      </div>
                    )}
                    {item.kind === 'event' ? (
                      <JoinEventLine event={item.event} />
                    ) : (
                      <ChannelMessage
                        continuation={continuation}
                        detail={detail}
                        highlighted={highlighted === item.message.id}
                        message={item.message}
                        threadId={threadId}
                        onJumpToMessage={jumpToMessage}
                        onOpenThread={onOpenThread}
                        onStartThread={channelArchived ? undefined : onStartThread}
                        onReply={
                          channelArchived || thread?.status === 'archived' ? undefined : selectReply
                        }
                      />
                    )}
                  </Fragment>
                ))}
              </WideScreenContainer>
            </Flexbox>
            {channelArchived || thread?.status === 'archived' ? (
              <ArchivedNotice channel={detail.channel} threadId={threadId} />
            ) : (
              <Composer
                activity={<ReplyActivity detail={detail} threadId={threadId} />}
                draftKey={channelDraftKey(channelId, threadId)}
                key={channelDraftKey(channelId, threadId)}
                members={activeMembers}
                replyTarget={reply.target}
                threadId={threadId}
                placeholder={
                  threadId ? t('threadComposer') : t('composer', { name: detail.channel.title })
                }
                onCancelReply={() => reply.clear()}
                onSend={async (content, mentions, requestKey, fileIds, replyToId) => {
                  const sentReply = reply.snapshot();
                  const sentLocation = currentLocation.current;
                  const sentScope = cacheScope.get();
                  sending.current = true;
                  try {
                    followLatest.current = true;
                    const message = await channelActions.send({
                      channelId,
                      content,
                      fileIds,
                      mentions,
                      requestKey,
                      replyToId,
                      threadId,
                    });
                    reply.clear(sentReply);
                    if (
                      mounted.current &&
                      sentScope === cacheScope.get() &&
                      sentLocation.pathname === currentLocation.current.pathname &&
                      sentLocation.search === currentLocation.current.search
                    ) {
                      setBefore(undefined);
                      if (!threadId && message.threadId) onOpenThread?.(message.threadId, false);
                    }
                  } finally {
                    sending.current = false;
                  }
                }}
              />
            )}
          </>
        )}
      </AsyncBoundary>
    </Flexbox>
  );
};

/** Each mounted conversation owns its editor, scroll position and execution scope. */
export function ChannelConversation(props: ChannelConversationProps) {
  const { channelId, threadId } = props;
  const scope = cacheScope.use();
  return (
    <Provider
      key={`${scope}:${channelId}:${threadId ?? 'main'}`}
      createStore={() =>
        createStore({
          context: { agentId: `channel:${channelId}`, topicId: threadId },
          messages: [],
          skipFetch: true,
        })
      }
    >
      <Timeline {...props} />
    </Provider>
  );
}

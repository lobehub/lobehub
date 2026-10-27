import { Button, Empty, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { MessageSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import AsyncError from '@/components/AsyncError';
import { createStore, Provider } from '@/features/Conversation/store';
import WideScreenContainer from '@/features/WideScreenContainer';
import { channelService } from '@/services/channel';
import { channelActions, channelSelectors, useChannelStore } from '@/store/channel';

import { ArchivedNotice } from './ArchivedNotice';
import { visibleChannelDetail } from './channelAccess';
import { ChannelMessage, ThreadRootMessage } from './ChannelMessage';
import { Composer } from './Composer';
import { isChannelJobActive } from './jobStatus';
import { JoinEventLine } from './JoinEventLine';
import { channelJoinEvents, channelTimeline } from './joinEvents';
import { ReplyActivity } from './ReplyActivity';
import { styles } from './styles';
import type { ChannelThreadDraft } from './threadDraft';
import { useChannelEvents } from './useChannelEvents';
import { channelDraftKey } from './useComposerDraft';

interface ChannelConversationProps {
  channelId: string;
  /** Mounted beside a thread panel that covers it, so keep it out of the tab order. */
  inert?: boolean;
  onOpenThread?: (threadId: string) => void;
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
  const { t } = useTranslation('channel');
  const [before, setBefore] = useState<number>();
  const [actionError, setActionError] = useState<unknown>();
  const params = { before, channelId, threadId };
  const sync = channelActions.useFetchDetail(params);
  const cached = useChannelStore(channelSelectors.detail(params));
  const detail = visibleChannelDetail(cached, sync.error);
  const feedRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const lastMessageId = detail?.messages.at(-1)?.id;
  const sequence = detail?.channel.sequence;
  useChannelEvents(params);

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

  const stop = async () => {
    setActionError(undefined);
    try {
      await channelActions.stop(channelId, { threadId });
    } catch (cause) {
      console.error('Failed to stop Channel replies', cause);
      setActionError(cause);
    }
  };

  const activeMembers = detail?.members.filter((member) => member.status === 'active') ?? [];
  const thread = threadId ? detail?.threads.find((entry) => entry.id === threadId) : undefined;
  const channelArchived = detail?.channel.status === 'archived';
  // Unmentioned messages go to every Agent on the main conversation, to followers in a Thread.
  const followerIds = threadId ? (thread?.followerMemberIds ?? []) : undefined;
  const defaultRecipientIds = activeMembers
    .filter((member) => member.actorType === 'agent')
    .filter((member) => !followerIds || followerIds.includes(member.id))
    .map((member) => member.id);
  // Members stop only their own requests; the server narrows a branch stop the same way.
  const stoppable = detail?.jobs.some(
    (job) => (job.threadId ?? null) === threadId && isChannelJobActive(job) && job.canStop,
  );
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
                  <ThreadRootMessage detail={detail} root={detail.rootMessage} />
                )}
                {!timeline.length &&
                  (threadId ? (
                    <p {...stylex.props(styles.muted)}>{t('threadEmpty')}</p>
                  ) : (
                    <Empty icon={MessageSquare} title={t('conversationEmpty')} />
                  ))}
                {timeline.map((item) =>
                  item.kind === 'event' ? (
                    <JoinEventLine event={item.event} key={item.event.id} />
                  ) : (
                    <ChannelMessage
                      detail={detail}
                      key={item.message.id}
                      message={item.message}
                      threadId={threadId}
                      onOpenThread={onOpenThread}
                      onStartThread={channelArchived ? undefined : onStartThread}
                    />
                  ),
                )}
              </WideScreenContainer>
            </Flexbox>
            {actionError !== undefined && (
              <WideScreenContainer fullWidth paddingInline={24}>
                <AsyncError error={actionError} variant="inline" />
              </WideScreenContainer>
            )}
            {channelArchived || thread?.status === 'archived' ? (
              <ArchivedNotice channel={detail.channel} threadId={threadId} />
            ) : (
              <Composer
                activity={<ReplyActivity detail={detail} threadId={threadId} />}
                defaultRecipientIds={defaultRecipientIds}
                draftKey={channelDraftKey(channelId, threadId)}
                inThread={!!threadId}
                key={channelDraftKey(channelId, threadId)}
                members={activeMembers}
                placeholder={t(threadId ? 'threadComposer' : 'composer')}
                stoppable={stoppable}
                onStop={() => void stop()}
                onSend={async (content, mentions, requestKey, fileIds) => {
                  followLatest.current = true;
                  await channelActions.send({
                    channelId,
                    content,
                    fileIds,
                    mentions,
                    requestKey,
                    threadId,
                  });
                  setBefore(undefined);
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
  return (
    <Provider
      key={`${channelId}:${threadId ?? 'main'}`}
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

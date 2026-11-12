import { cssVar, Flexbox, Tag, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useSize } from 'ahooks';
import { Hash } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import NotFound from '@/components/404';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { EntityLinkHostProvider } from '@/features/EntityLink/host';
import NavHeader from '@/features/NavHeader';
import { channelActions, channelSelectors, useChannelStore } from '@/store/channel';
import { useChatStore } from '@/store/chat';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { AgentProfilePanel } from './AgentProfilePanel';
import { visibleChannelDetail } from './channelAccess';
import { ChannelConversation } from './ChannelConversation';
import { MEMBER_FLOAT_BREAKPOINT, MemberPanel } from './MemberPanel';
import { MemberStatus } from './MemberStatus';
import { openTopic } from './openTopic';
import { CHANNEL_ENTITY_PORTAL_SCOPE, PortalPanel } from './PortalPanel';
import { type ReplyTopic, ReplyTopicPanel } from './ReplyTopicPanel';
import { styles } from './styles';
import { ThreadPageActions, ThreadPageTitle } from './ThreadPageTitle';
import { THREAD_FLOAT_BREAKPOINT, ThreadPanel } from './ThreadPanel';
import { channelBrowserSessionId, usePortalPanelOpen } from './usePortalPanel';
import { useThreadPanel } from './useThreadPanel';

/** One Channel: the main conversation, with a thread beside it, or one thread as the page. */
function EnabledChannelPage() {
  const { t } = useTranslation('channel');
  const { channelId } = useParams<{ channelId: string }>();
  const panel = useThreadPanel(channelId ?? '');
  const [membersChannelId, setMembersChannelId] = useState<string | null>(null);
  const memberPanelId = useId();
  const conversationRef = useRef<HTMLDivElement>(null);
  const conversationWidth = useSize(conversationRef)?.width;
  // Shares the main conversation's request; the header and thread panel read the same view.
  const view = { channelId: channelId ?? '', threadId: null };
  const sync = channelActions.useFetchDetail(channelId ? view : null);
  const detail = visibleChannelDetail(useChannelStore(channelSelectors.detail(view)), sync.error);
  const directAgent = detail?.channel.agentId
    ? detail.members.find((member) => member.agentId === detail.channel.agentId)
    : undefined;
  const [topic, setTopic] = useState<(ReplyTopic & { channelId: string }) | null>(null);
  const portalOpen = usePortalPanelOpen();
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);
  const openBrowser = useChatStore((s) => s.openBrowser);
  // One side panel at a time. A report or web page covers whatever was open and uncovers it
  // when closed; explicitly opening another panel closes it.
  const threadId = portalOpen ? null : panel.threadId;
  const threadDraft = portalOpen ? null : panel.draft;
  const pageThreadId = panel.pageThreadId;
  // A direct conversation's side panel is its Agent's profile; a workspace group's is the roster.
  const hasMemberPanel =
    !!directAgent || (!!detail?.channel.workspaceId && !detail.channel.agentId);
  const membersOpen =
    hasMemberPanel && membersChannelId === channelId && !threadId && !threadDraft && !portalOpen;
  const visibleTopic = openTopic(topic, channelId, {
    portal: portalOpen,
    members: membersOpen,
    thread: !!(threadId || threadDraft || pageThreadId),
  });
  if (!channelId) return null;

  return (
    <Flexbox {...stylex.props(styles.layout)}>
      <NavHeader
        // A rule separates the header from the feed scrolling under it.
        {...stylex.props(styles.threadHeader)}
        left={
          pageThreadId && detail ? (
            <ThreadPageTitle detail={detail} threadId={pageThreadId} onBack={panel.close} />
          ) : (
            <Flexbox horizontal align="center" gap={8}>
              {/* A direct conversation is titled by its Agent's name alone, like an IM chat. */}
              {!directAgent && <Hash color={cssVar.colorTextDescription} size={16} />}
              <Text ellipsis weight={500}>
                {detail?.channel.title || t('title')}
              </Text>
              {detail?.channel.status === 'archived' && <Tag size="small">{t('archived')}</Tag>}
            </Flexbox>
          )
        }
        right={
          detail && (
            <Flexbox horizontal align="center" gap={8}>
              {pageThreadId && <ThreadPageActions detail={detail} threadId={pageThreadId} />}
              <MemberStatus
                detail={detail}
                memberPanel={
                  hasMemberPanel
                    ? {
                        id: memberPanelId,
                        open: membersOpen,
                        onToggle: () => {
                          if (!membersOpen) {
                            // The roster sits beside a thread page; it only replaces a side panel.
                            if (!pageThreadId) panel.close();
                            setTopic(null);
                            clearPortalStack();
                          }
                          setMembersChannelId(membersOpen ? null : channelId);
                        },
                      }
                    : undefined
                }
              />
            </Flexbox>
          )
        }
      />
      <EntityLinkHostProvider
        portal={CHANNEL_ENTITY_PORTAL_SCOPE}
        onOpenSideBrowser={(url) => openBrowser(channelBrowserSessionId(channelId), url)}
      >
        <Flexbox horizontal ref={conversationRef} {...stylex.props(styles.conversations)}>
          {pageThreadId ? (
            <ChannelConversation
              channelId={channelId}
              key={`${channelId}:${pageThreadId}`}
              threadId={pageThreadId}
              inert={
                (membersOpen && (conversationWidth ?? 1000) < MEMBER_FLOAT_BREAKPOINT) ||
                (portalOpen && (conversationWidth ?? 1000) < THREAD_FLOAT_BREAKPOINT)
              }
            />
          ) : (
            <ChannelConversation
              channelId={channelId}
              key={channelId}
              inert={
                (!!(threadId || threadDraft || portalOpen) &&
                  (conversationWidth ?? 1000) < THREAD_FLOAT_BREAKPOINT) ||
                (membersOpen && (conversationWidth ?? 1000) < MEMBER_FLOAT_BREAKPOINT) ||
                (!!visibleTopic && (conversationWidth ?? 1000) < THREAD_FLOAT_BREAKPOINT)
              }
              onOpenThread={(nextThreadId, toggle) => {
                setTopic(null);
                // A send that finishes behind an open report (toggle: false) must not close it.
                if (toggle !== false) clearPortalStack();
                // Under a report the thread only looks closed, so bring it back, don't toggle it off.
                panel.openThread(nextThreadId, portalOpen ? false : toggle);
              }}
              onOpenTopic={(next) => {
                panel.close();
                setMembersChannelId(null);
                clearPortalStack();
                setTopic({ ...next, channelId });
              }}
              onStartThread={(draft) => {
                setTopic(null);
                clearPortalStack();
                panel.openDraft(draft);
              }}
            />
          )}
          {detail &&
            membersOpen &&
            (directAgent?.agentId ? (
              <AgentProfilePanel
                agentId={directAgent.agentId}
                availableWidth={conversationWidth}
                id={memberPanelId}
                key={directAgent.agentId}
                member={directAgent}
                onClose={() => setMembersChannelId(null)}
              />
            ) : (
              <MemberPanel
                availableWidth={conversationWidth}
                detail={detail}
                id={memberPanelId}
                onClose={() => setMembersChannelId(null)}
              />
            ))}
          <ReplyTopicPanel
            availableWidth={conversationWidth}
            topic={visibleTopic}
            onClose={() => setTopic(null)}
          />
          {detail && (
            <ThreadPanel
              availableWidth={conversationWidth}
              detail={detail}
              draft={threadDraft}
              key={`thread:${channelId}`}
              threadId={threadId}
              onClose={panel.close}
              onOpenPage={panel.openPage}
              onSendDraft={panel.send}
            />
          )}
          <PortalPanel availableWidth={conversationWidth} channelId={channelId} />
        </Flexbox>
      </EntityLinkHostProvider>
    </Flexbox>
  );
}

/** Do not mount subscriptions or conversations unless the `channel` flag is on for the user. */
export default function ChannelPage() {
  const ready = useServerConfigStore((s) => s.serverConfigInit);
  const enabled = useServerConfigStore(serverConfigSelectors.enableChannels);
  // Continue the route skeleton while the flag resolves instead of swapping to a spinner.
  if (!ready) return <RouteLoading />;
  return enabled ? <EnabledChannelPage /> : <NotFound />;
}

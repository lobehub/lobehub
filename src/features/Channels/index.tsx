import { Center, Flexbox, Spin, Tag, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useSize } from 'ahooks';
import { Hash } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import NotFound from '@/components/404';
import NavHeader from '@/features/NavHeader';
import { channelActions, channelSelectors, useChannelStore } from '@/store/channel';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { visibleChannelDetail } from './channelAccess';
import { ChannelConversation } from './ChannelConversation';
import { MEMBER_FLOAT_BREAKPOINT, MemberPanel } from './MemberPanel';
import { MemberStatus } from './MemberStatus';
import { styles } from './styles';
import { THREAD_FLOAT_BREAKPOINT, ThreadPanel } from './ThreadPanel';
import { useThreadPanel } from './useThreadPanel';

/** One Channel: the main conversation, with a thread beside it. */
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
  const membersOpen =
    !!detail?.channel.workspaceId &&
    membersChannelId === channelId &&
    !panel.threadId &&
    !panel.draft;
  if (!channelId) return null;

  return (
    <Flexbox {...stylex.props(styles.layout)}>
      <NavHeader
        left={
          <Flexbox horizontal align="center" gap={8}>
            <Hash size={18} />
            <Text ellipsis weight={500}>
              {detail?.channel.title || t('title')}
            </Text>
            {detail?.channel.status === 'archived' && <Tag size="small">{t('archived')}</Tag>}
          </Flexbox>
        }
        right={
          detail && (
            <MemberStatus
              detail={detail}
              memberPanel={
                detail.channel.workspaceId
                  ? {
                      id: memberPanelId,
                      open: membersOpen,
                      onToggle: () => {
                        if (!membersOpen) panel.close();
                        setMembersChannelId(membersOpen ? null : channelId);
                      },
                    }
                  : undefined
              }
            />
          )
        }
      />
      <Flexbox horizontal ref={conversationRef} {...stylex.props(styles.conversations)}>
        <ChannelConversation
          channelId={channelId}
          key={channelId}
          inert={
            (!!(panel.threadId || panel.draft) &&
              (conversationWidth ?? 1000) < THREAD_FLOAT_BREAKPOINT) ||
            (membersOpen && (conversationWidth ?? 1000) < MEMBER_FLOAT_BREAKPOINT)
          }
          onOpenThread={panel.openThread}
          onStartThread={panel.openDraft}
        />
        {detail && membersOpen && (
          <MemberPanel
            availableWidth={conversationWidth}
            detail={detail}
            id={memberPanelId}
            onClose={() => setMembersChannelId(null)}
          />
        )}
        {detail && (
          <ThreadPanel
            availableWidth={conversationWidth}
            detail={detail}
            draft={panel.draft}
            key={`thread:${channelId}`}
            threadId={panel.threadId}
            onClose={panel.close}
            onSendDraft={panel.send}
          />
        )}
      </Flexbox>
    </Flexbox>
  );
}

/** Do not mount subscriptions or conversations unless the `channel` flag is on for the user. */
export default function ChannelPage() {
  const ready = useServerConfigStore((s) => s.serverConfigInit);
  const enabled = useServerConfigStore(serverConfigSelectors.enableChannels);
  if (!ready)
    return (
      <Center height="100%">
        <Spin />
      </Center>
    );
  return enabled ? <EnabledChannelPage /> : <NotFound />;
}

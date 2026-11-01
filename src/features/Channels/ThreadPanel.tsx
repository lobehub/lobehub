import type { ChannelDetail } from '@lobechat/types';
import { ActionIcon, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { GitBranch, MoreHorizontal, X } from 'lucide-react';
import { Activity, type ComponentProps, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import RightPanel from '@/features/RightPanel';
import { channelSelectors, useChannelStore } from '@/store/channel';

import { ChannelConversation } from './ChannelConversation';
import { DraftThreadConversation } from './DraftThreadConversation';
import { MemberAvatar } from './MemberAvatar';
import { memberName } from './memberName';
import { styles } from './styles';
import { type ChannelThreadDraft, draftThreadFollowerIds } from './threadDraft';
import { threadTitle } from './threadTitle';
import { useThreadMenu } from './useThreadMenu';

/** Below this width the thread floats over the channel instead of sitting beside it. */
export const THREAD_FLOAT_BREAKPOINT = 760;

const MAX_FOLLOWER_AVATARS = 3;

const ThreadFollowers = ({
  detail,
  target,
}: {
  detail: ChannelDetail;
  target: string | ChannelThreadDraft;
}) => {
  const { t } = useTranslation('channel');
  const { members = [], threads = [] } = detail;
  const followerIds =
    typeof target === 'string'
      ? (threads.find((entry) => entry.id === target)?.followerMemberIds ?? [])
      : draftThreadFollowerIds(target.root, members);
  const followers = members.filter(
    (member) => member.status === 'active' && followerIds.includes(member.id),
  );
  if (!followers.length) return null;
  const names = followers.map((member) => memberName(member, t('deletedMember'))).join('、');
  const overflow = followers.length - MAX_FOLLOWER_AVATARS;
  return (
    <Flexbox
      horizontal
      align="center"
      aria-label={t('followers', { names })}
      gap={4}
      role="img"
      title={t('followers', { names })}
    >
      {followers.slice(0, MAX_FOLLOWER_AVATARS).map((member) => (
        <MemberAvatar key={member.id} member={member} size={20} />
      ))}
      {overflow > 0 && (
        <Text fontSize={12} type="secondary">
          +{overflow}
        </Text>
      )}
    </Flexbox>
  );
};

export function ThreadPanel({
  availableWidth = 1000,
  detail,
  threadId,
  draft,
  onClose,
  onSendDraft,
}: {
  availableWidth?: number;
  detail: ChannelDetail;
  draft: ChannelThreadDraft | null;
  onClose: () => void;
  onSendDraft: ComponentProps<typeof DraftThreadConversation>['onSend'];
  threadId: string | null;
}) {
  const { t } = useTranslation('channel');
  const threadMenu = useThreadMenu();
  // Keep the last preview/conversation mounted while the panel animates closed.
  const target = threadId || draft;
  const [lastTarget, setLastTarget] = useState(target);
  const [preferredWidth, setPreferredWidth] = useState(520);
  if (target && target !== lastTarget) setLastTarget(target);
  const narrow = availableWidth < THREAD_FLOAT_BREAKPOINT;
  const maxWidth = narrow ? availableWidth : availableWidth - 360;
  const width = Math.min(preferredWidth, maxWidth);
  const channelId = detail.channel?.id ?? '';
  const { messages = [], threads = [] } = detail;
  const lastThreadId = typeof lastTarget === 'string' ? lastTarget : null;
  // Same name as the sidebar entry: the first line of the message the thread branched from.
  const threadView = useChannelStore(
    channelSelectors.detail({ channelId, threadId: lastThreadId }),
  );
  const rootMessageId = threads.find((entry) => entry.id === lastThreadId)?.rootMessageId;
  const openThread = threadId ? threads.find((entry) => entry.id === threadId) : undefined;
  const menuItems = openThread ? threadMenu(detail.channel, openThread) : [];
  const title =
    threadTitle(
      (lastTarget && typeof lastTarget !== 'string' ? lastTarget.root : threadView?.rootMessage) ??
        messages.find((message) => message.id === rootMessageId),
    ) || t('thread');

  return (
    <RightPanel
      className={stylex.props(styles.threadPanel).className}
      classNames={{ content: stylex.props(styles.threadContent).className }}
      expand={!!target}
      maxWidth={maxWidth}
      minWidth={Math.min(360, maxWidth)}
      mode={narrow ? 'float' : 'fixed'}
      showHandleWhenCollapsed={false}
      showHandleWideArea={false}
      width={narrow ? availableWidth : width}
      onExpandChange={(expand) => {
        if (!expand) onClose();
      }}
      onSizeChange={(size) => {
        const next = Number.parseFloat(String(size?.width));
        if (Number.isFinite(next)) setPreferredWidth(next);
      }}
    >
      <Activity mode={target ? 'visible' : 'hidden'}>
        <Flexbox aria-label={t('thread')} role="region" {...stylex.props(styles.body)}>
          <NavHeader
            paddingBlock={6}
            paddingInline={8}
            showTogglePanelButton={false}
            left={
              <Flexbox
                horizontal
                align="center"
                gap={8}
                style={{ marginInlineStart: 4, minWidth: 0 }}
              >
                <Icon icon={GitBranch} size={18} />
                <Text ellipsis fontSize={14} title={title}>
                  {title}
                </Text>
              </Flexbox>
            }
            right={
              <Flexbox horizontal align="center" gap={8}>
                {lastTarget && <ThreadFollowers detail={detail} target={lastTarget} />}
                {menuItems.length > 0 && (
                  <DropdownMenu items={menuItems}>
                    <ActionIcon
                      aria-label={t('more', { ns: 'common' })}
                      icon={MoreHorizontal}
                      size="small"
                      title={t('more', { ns: 'common' })}
                    />
                  </DropdownMenu>
                )}
                <ActionIcon
                  aria-label={t('closeThread')}
                  icon={X}
                  size="small"
                  title={t('closeThread')}
                  onClick={onClose}
                />
              </Flexbox>
            }
            {...stylex.props(styles.threadHeader)}
          />
          {typeof lastTarget === 'string' ? (
            <ChannelConversation
              channelId={detail.channel.id}
              key={lastTarget}
              threadId={lastTarget}
            />
          ) : lastTarget ? (
            <DraftThreadConversation
              detail={detail}
              draft={lastTarget}
              key={lastTarget.root.id}
              onSend={onSendDraft}
            />
          ) : null}
        </Flexbox>
      </Activity>
    </RightPanel>
  );
}

import type { ChannelDetail } from '@lobechat/types';
import { ActionIcon, cssVar, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight, GitBranch, Hash, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { channelSelectors, useChannelStore } from '@/store/channel';

import { styles } from './styles';
import { ThreadFollowers } from './ThreadPanel';
import { threadTitle } from './threadTitle';
import { useThreadMenu } from './useThreadMenu';

/** The header of a thread opened as the page: `# Channel › thread`, the Channel leading back. */
export const ThreadPageTitle = ({
  detail,
  onBack,
  threadId,
}: {
  detail: ChannelDetail;
  onBack: () => void;
  threadId: string;
}) => {
  const { t } = useTranslation('channel');
  const channelId = detail.channel.id;
  const threadView = useChannelStore(channelSelectors.detail({ channelId, threadId }));
  const thread = detail.threads.find((entry) => entry.id === threadId);
  const title =
    threadTitle(
      threadView?.rootMessage ??
        detail.messages.find((message) => message.id === thread?.rootMessageId),
      thread,
    ) || t('thread');
  const channelTitle = detail.channel.title || t('title');

  return (
    <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
      <button type="button" {...stylex.props(styles.crumb)} onClick={onBack}>
        <Hash color={cssVar.colorTextDescription} size={16} />
        <Text ellipsis type="secondary">
          {channelTitle}
        </Text>
      </button>
      <Icon color={cssVar.colorTextDescription} icon={ChevronRight} size={14} />
      <Icon icon={GitBranch} size={16} />
      <Text ellipsis title={title} weight={500}>
        {title}
      </Text>
    </Flexbox>
  );
};

/** Followers and the thread menu, as the side panel shows them. */
export const ThreadPageActions = ({
  detail,
  threadId,
}: {
  detail: ChannelDetail;
  threadId: string;
}) => {
  const { t } = useTranslation('channel');
  const threadMenu = useThreadMenu();
  const thread = detail.threads.find((entry) => entry.id === threadId);
  const menuItems = thread ? threadMenu(detail.channel, thread) : [];
  return (
    <Flexbox horizontal align="center" gap={8}>
      <ThreadFollowers detail={detail} target={threadId} />
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
    </Flexbox>
  );
};

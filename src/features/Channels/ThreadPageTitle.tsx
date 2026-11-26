import type { ChannelDetail } from '@lobechat/types';
import { cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight, GitBranch, Hash } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { channelSelectors, useChannelStore } from '@/store/channel';

import { styles } from './styles';
import { threadTitle } from './threadTitle';

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

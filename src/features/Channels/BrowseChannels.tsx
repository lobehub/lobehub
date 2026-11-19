import type { ChannelJoinableItem } from '@lobechat/types';
import {
  Button,
  createModal,
  Flexbox,
  Icon,
  Input,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useDebounce } from 'ahooks';
import { t } from 'i18next';
import { Hash, Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { channelActions, channelSelectors, useChannelStore } from '@/store/channel';
import { useInterfaceDensity } from '@/styles/density';
import { densityTokens } from '@/styles/density.stylex';

const styles = stylex.create({
  list: {
    overflowY: 'auto',
    height: 400,
    maxHeight: '55vh',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: densityTokens['--lobe-density-content-gap'],
    paddingBlock: 8,
    paddingInline: 8,
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
  },
  rowCompact: {
    gap: 8,
    paddingBlock: 4,
  },
  note: { paddingBlock: 24, textAlign: 'center' },
});

interface BrowseChannelsProps {
  onJoined?: (channel: ChannelJoinableItem) => void;
}

/** Public Channels of the active workspace the user is not in yet; joining one opens it. */
function BrowseChannels({ onJoined }: BrowseChannelsProps) {
  const { t } = useTranslation('channel');
  const { close } = useModalContext();
  const compact = useInterfaceDensity() === 'compact';
  const [search, setSearch] = useState('');
  const [joining, setJoining] = useState<string>();
  const query = useDebounce(search.trim(), { wait: 200 });
  const sync = channelActions.useFetchJoinable(query);
  const data = useChannelStore(channelSelectors.joinable(query));

  const join = async (channel: ChannelJoinableItem) => {
    setJoining(channel.id);
    try {
      await channelActions.join(channel.id, query);
      close();
      onJoined?.(channel);
    } catch (cause) {
      console.error('Failed to join Channel', cause);
      toast.error(t('browse.joinFailed'));
      void sync.revalidate();
    } finally {
      setJoining(undefined);
    }
  };

  return (
    <Flexbox gap={12}>
      <Input
        allowClear
        aria-label={t('browse.search')}
        placeholder={t('browse.search')}
        prefix={<Icon icon={Search} />}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div {...stylex.props(styles.list)}>
        <AsyncBoundary
          data={data}
          error={sync.error}
          isEmpty={data?.length === 0}
          isLoading={!data && !sync.error}
          empty={
            <Text as="p" type="secondary" {...stylex.props(styles.note)}>
              {t(query ? 'browse.noMatches' : 'browse.empty')}
            </Text>
          }
          onRetry={() => void sync.revalidate()}
        >
          {data?.map((channel) => (
            <div key={channel.id} {...stylex.props(styles.row, compact && styles.rowCompact)}>
              <Icon icon={Hash} size={16} />
              <Flexbox flex={1} style={{ minWidth: 0 }}>
                <Text ellipsis fontSize={compact ? 13 : undefined} weight={500}>
                  {channel.title}
                </Text>
                <Text fontSize={12} type="secondary">
                  {t('browse.memberCount', { count: channel.memberCount })}
                </Text>
              </Flexbox>
              <Button
                disabled={!!joining && joining !== channel.id}
                loading={joining === channel.id}
                size="small"
                onClick={() => void join(channel)}
              >
                {t('browse.join')}
              </Button>
            </div>
          ))}
        </AsyncBoundary>
      </div>
    </Flexbox>
  );
}

export const openBrowseChannels = (onJoined?: BrowseChannelsProps['onJoined']) =>
  createModal({
    content: <BrowseChannels onJoined={onJoined} />,
    footer: null,
    title: t('browse.title', { ns: 'channel' }),
    width: 'min(90vw, 560px)',
  });

'use client';

import type {
  BuiltinRenderProps,
  ChannelDirectoryPage,
  ChannelHistoryMessageDetail,
  ChannelHistoryPage,
  ChannelSendMessageParams,
  ChannelSentMessage,
} from '@lobechat/types';
import { Button, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { CircleAlertIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChannelApiName } from '../../types';

/** One readable line saying what failed and what to do; the raw message stays folded. */
const ChannelErrorDetail = memo<{ detail?: string; summary: string }>(({ detail, summary }) => {
  const { t } = useTranslation('plugin');
  const [expanded, setExpanded] = useState(false);

  // A new failure starts folded again.
  useEffect(() => setExpanded(false), [detail]);

  return (
    <Flexbox gap={4} paddingBlock={8} role={'alert'}>
      <Flexbox horizontal align={'center'} gap={6}>
        <Icon color={cssVar.colorError} icon={CircleAlertIcon} size={14} />
        <Text type={'danger'}>{summary}</Text>
        {detail && (
          <Button size={'small'} type={'link'} onClick={() => setExpanded((value) => !value)}>
            {t(
              expanded
                ? 'builtins.lobe-channel.errorDetailHide'
                : 'builtins.lobe-channel.errorDetailShow',
            )}
          </Button>
        )}
      </Flexbox>
      {expanded && detail && (
        <Text fontSize={12} style={{ wordBreak: 'break-word' }} type={'secondary'}>
          {detail}
        </Text>
      )}
    </Flexbox>
  );
});
ChannelErrorDetail.displayName = 'ChannelErrorDetail';

const ChannelHistoryRender = memo<
  BuiltinRenderProps<unknown, ChannelHistoryPage | ChannelHistoryMessageDetail, string>
>(({ content, pluginError, pluginState }) => {
  const { t } = useTranslation('plugin');
  if (pluginError)
    return (
      <ChannelErrorDetail
        detail={pluginError.message || content}
        summary={t('builtins.lobe-channel.readError')}
      />
    );
  if (!pluginState) return null;
  const page = 'messages' in pluginState;
  const messages = page ? pluginState.messages : [pluginState.message];
  if (messages.length === 0)
    return <Text type={'secondary'}>{t('builtins.lobe-channel.empty')}</Text>;
  return (
    <Flexbox gap={12} paddingBlock={8}>
      <Text type={'secondary'}>
        {page
          ? t('builtins.lobe-channel.messageCount', { count: messages.length })
          : t('builtins.lobe-channel.chunk', {
              start: pluginState.offset,
              end: pluginState.offset + pluginState.message.content.length,
              total: pluginState.message.contentLength,
            })}
      </Text>
      <Flexbox gap={12} style={{ maxHeight: 320, overflow: 'auto' }}>
        {messages.map((message) => (
          <Flexbox gap={4} key={message.id}>
            <Text weight={500}>{`#${message.sequence} · ${message.author.name}`}</Text>
            <div style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
              {message.content.slice(0, 300)}
            </div>
            {(message.content.length > 300 || message.truncated) && (
              <Text type={'secondary'}>{t('builtins.lobe-channel.excerpt')}</Text>
            )}
          </Flexbox>
        ))}
      </Flexbox>
      {page && pluginState.nextBeforeSequence !== null && (
        <Text type={'secondary'}>{t('builtins.lobe-channel.moreHistory')}</Text>
      )}
    </Flexbox>
  );
});
ChannelHistoryRender.displayName = 'ChannelHistoryRender';

const ListChannelsRender = memo<BuiltinRenderProps<unknown, ChannelDirectoryPage, string>>(
  ({ content, pluginError, pluginState }) => {
    const { t } = useTranslation('plugin');
    if (pluginError)
      return (
        <ChannelErrorDetail
          detail={pluginError.message || content}
          summary={t('builtins.lobe-channel.listError')}
        />
      );
    if (!pluginState) return null;
    if (pluginState.channels.length === 0)
      return <Text type={'secondary'}>{t('builtins.lobe-channel.noChannels')}</Text>;
    return (
      <Flexbox gap={8} paddingBlock={8}>
        {pluginState.channels.map((channel) => (
          <Flexbox gap={2} key={channel.id}>
            <Text weight={500}>{`# ${channel.title}`}</Text>
            <Text type={'secondary'}>
              {channel.agents.map(({ name }) => name).join(' · ') ||
                t('builtins.lobe-channel.noAgents')}
            </Text>
          </Flexbox>
        ))}
      </Flexbox>
    );
  },
);
ListChannelsRender.displayName = 'ChannelListChannelsRender';

const SendMessageRender = memo<
  BuiltinRenderProps<ChannelSendMessageParams, ChannelSentMessage, string>
>(({ args, content, pluginError, pluginState }) => {
  const { t } = useTranslation('plugin');
  if (pluginError)
    return (
      <ChannelErrorDetail
        detail={pluginError.message || content}
        summary={t('builtins.lobe-channel.sendError')}
      />
    );
  if (!pluginState) return null;
  return (
    <Flexbox gap={8} paddingBlock={8}>
      <Text type={'secondary'}>
        {t('builtins.lobe-channel.sentTo', {
          agents: pluginState.agents.map(({ name }) => `@${name}`).join(' '),
          channel: pluginState.channelTitle,
        })}
      </Text>
      {args?.content && (
        <div style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
          {args.content.slice(0, 600)}
        </div>
      )}
      <a href={pluginState.url} rel={'noreferrer'} target={'_blank'}>
        {t('builtins.lobe-channel.openChannel')}
      </a>
    </Flexbox>
  );
});
SendMessageRender.displayName = 'ChannelSendMessageRender';

export const ChannelRenders = {
  [ChannelApiName.listChannels]: ListChannelsRender,
  [ChannelApiName.readMessage]: ChannelHistoryRender,
  [ChannelApiName.readMessages]: ChannelHistoryRender,
  [ChannelApiName.sendMessage]: SendMessageRender,
};

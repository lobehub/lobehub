'use client';

import type {
  BuiltinRenderProps,
  ChannelHistoryMessageDetail,
  ChannelHistoryPage,
} from '@lobechat/types';
import { Alert, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChannelApiName } from '../../types';

const ChannelHistoryRender = memo<
  BuiltinRenderProps<unknown, ChannelHistoryPage | ChannelHistoryMessageDetail, string>
>(({ content, pluginError, pluginState }) => {
  const { t } = useTranslation('plugin');
  if (pluginError)
    return (
      <Alert
        description={pluginError.message || content}
        title={t('builtins.lobe-channel.readError')}
        type={'error'}
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

export const ChannelRenders = {
  [ChannelApiName.readMessage]: ChannelHistoryRender,
  [ChannelApiName.readMessages]: ChannelHistoryRender,
};

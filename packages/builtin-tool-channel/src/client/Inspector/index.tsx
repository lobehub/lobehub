'use client';

import type {
  BuiltinInspectorProps,
  ChannelDirectoryPage,
  ChannelHistoryMessageDetail,
  ChannelHistoryPage,
  ChannelSendMessageParams,
  ChannelSentMessage,
} from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import { ChannelApiName } from '../../types';

const ChannelInspector = memo<
  BuiltinInspectorProps<unknown, ChannelHistoryPage | ChannelHistoryMessageDetail>
>(({ apiName, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');
  const loading = isArgumentsStreaming || isLoading;
  return (
    <div className={cx(inspectorTextStyles.root, loading && shinyTextStyles.shinyText)}>
      <span>
        {t(
          apiName === ChannelApiName.readMessage
            ? 'builtins.lobe-channel.apiName.readMessage'
            : 'builtins.lobe-channel.apiName.readMessages',
        )}
      </span>
      {!loading && pluginState && (
        <span>
          {'messages' in pluginState
            ? t('builtins.lobe-channel.messageCount', { count: pluginState.messages.length })
            : `#${pluginState.message.sequence}`}
        </span>
      )}
    </div>
  );
});
ChannelInspector.displayName = 'ChannelInspector';

const ListChannelsInspector = memo<BuiltinInspectorProps<unknown, ChannelDirectoryPage>>(
  ({ isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');
    const loading = isArgumentsStreaming || isLoading;
    return (
      <div className={cx(inspectorTextStyles.root, loading && shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-channel.apiName.listChannels')}</span>
        {!loading && pluginState && (
          <span>
            {t('builtins.lobe-channel.channelCount', { count: pluginState.channels.length })}
          </span>
        )}
      </div>
    );
  },
);
ListChannelsInspector.displayName = 'ChannelListChannelsInspector';

const SendMessageInspector = memo<
  BuiltinInspectorProps<ChannelSendMessageParams, ChannelSentMessage>
>(({ isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');
  const loading = isArgumentsStreaming || isLoading;
  return (
    <div className={cx(inspectorTextStyles.root, loading && shinyTextStyles.shinyText)}>
      <span>{t('builtins.lobe-channel.apiName.sendMessage')}</span>
      {!loading && pluginState && (
        <span>{pluginState.agents.map(({ name }) => `@${name}`).join(' ')}</span>
      )}
    </div>
  );
});
SendMessageInspector.displayName = 'ChannelSendMessageInspector';

export const ChannelInspectors = {
  [ChannelApiName.listChannels]: ListChannelsInspector,
  [ChannelApiName.readMessage]: ChannelInspector,
  [ChannelApiName.readMessages]: ChannelInspector,
  [ChannelApiName.sendMessage]: SendMessageInspector,
};

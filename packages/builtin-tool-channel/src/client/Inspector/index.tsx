'use client';

import type {
  BuiltinInspectorProps,
  ChannelHistoryMessageDetail,
  ChannelHistoryPage,
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

export const ChannelInspectors = {
  [ChannelApiName.readMessage]: ChannelInspector,
  [ChannelApiName.readMessages]: ChannelInspector,
};

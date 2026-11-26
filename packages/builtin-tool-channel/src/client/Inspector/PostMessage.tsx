'use client';

import type {
  BuiltinInspectorProps,
  ChannelPostedMessage,
  ChannelPostMessageParams,
} from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

/** Where the post went, once it landed. */
export const PostMessageInspector = memo<
  BuiltinInspectorProps<ChannelPostMessageParams, ChannelPostedMessage>
>(({ isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');
  const loading = isArgumentsStreaming || isLoading;
  return (
    <div className={cx(inspectorTextStyles.root, loading && shinyTextStyles.shinyText)}>
      <span>{t('builtins.lobe-channel.apiName.postMessage')}</span>
      {!loading && pluginState?.channelTitle && <span>{`#${pluginState.channelTitle}`}</span>}
    </div>
  );
});
PostMessageInspector.displayName = 'ChannelPostMessageInspector';

'use client';

import type {
  BuiltinRenderProps,
  ChannelPostedMessage,
  ChannelPostMessageParams,
} from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

// Read only while rendering, so this import back into the registry module is safe.
import { ChannelErrorDetail } from './index';

/** Where the post landed, what it said, and how many cards went with it. */
export const PostMessageRender = memo<
  BuiltinRenderProps<ChannelPostMessageParams, ChannelPostedMessage, string>
>(({ args, content, pluginError, pluginState }) => {
  const { t } = useTranslation('plugin');
  if (pluginError)
    return (
      <ChannelErrorDetail
        detail={pluginError.message || content}
        summary={t('builtins.lobe-channel.postError')}
      />
    );
  if (!pluginState) return null;
  return (
    <Flexbox gap={8} paddingBlock={8}>
      <Text type={'secondary'}>
        {t(
          pluginState.threadId
            ? 'builtins.lobe-channel.postedToThread'
            : 'builtins.lobe-channel.postedTo',
          { channel: pluginState.channelTitle },
        )}
        {pluginState.cards > 0 &&
          ` · ${t('builtins.lobe-channel.postedCards', { count: pluginState.cards })}`}
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
PostMessageRender.displayName = 'ChannelPostMessageRender';

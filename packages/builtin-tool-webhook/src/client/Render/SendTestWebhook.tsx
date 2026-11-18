'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import type { SendTestWebhookState, WebhookIdArgs } from '../../types';
import ToolError from '../components/ToolError';
import { getToolError } from '../toolError';

/** Whether the receiver took the sample call; a refusal says why (a paused webhook, mostly). */
const SendTestWebhookRender = ({
  pluginError,
  pluginState,
}: BuiltinRenderProps<WebhookIdArgs, SendTestWebhookState>) => {
  const { t } = useTranslation('plugin');
  const error = getToolError(pluginState, pluginError);
  if (error) return <ToolError error={error} />;
  if (!pluginState) return null;

  if (pluginState.accepted)
    return (
      <Text style={{ fontSize: 13 }} type={'secondary'}>
        {t('builtins.lobe-webhook.render.testSent')}
      </Text>
    );

  return (
    <Text style={{ fontSize: 13 }} type={'warning'}>
      {t(
        pluginState.status === 409
          ? 'builtins.lobe-webhook.render.testPaused'
          : 'builtins.lobe-webhook.render.testRefused',
        { status: pluginState.status },
      )}
    </Text>
  );
};

export default SendTestWebhookRender;

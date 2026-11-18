'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import type { DeleteWebhookState, WebhookIdArgs } from '../../types';
import ToolError from '../components/ToolError';
import { getToolError } from '../toolError';

/** Confirms the webhook is gone: its URL no longer takes calls. */
const DeleteWebhookRender = ({
  pluginError,
  pluginState,
}: BuiltinRenderProps<WebhookIdArgs, DeleteWebhookState>) => {
  const { t } = useTranslation('plugin');
  const error = getToolError(pluginState, pluginError);
  if (error) return <ToolError error={error} />;
  if (!pluginState?.deleted) return null;

  return (
    <Text style={{ fontSize: 13 }} type={'secondary'}>
      {t('builtins.lobe-webhook.render.deletedWebhook')}
    </Text>
  );
};

export default DeleteWebhookRender;

'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { UnsubscribeEventArgs, UnsubscribeEventState } from '../../types';
import ToolError from '../components/ToolError';
import { getToolError } from '../toolError';

/** Confirms the subscription is gone — the agent can remove one without asking, so say so. */
const UnsubscribeEventRender = memo<
  BuiltinRenderProps<UnsubscribeEventArgs, UnsubscribeEventState>
>(({ pluginError, pluginState }) => {
  const { t } = useTranslation('plugin');
  const error = getToolError(pluginState, pluginError);
  if (error) return <ToolError error={error} />;
  if (!pluginState?.removed) return null;

  return (
    <Text style={{ fontSize: 13 }} type={'secondary'}>
      {t('builtins.lobe-mcp-events.render.unsubscribed')}
    </Text>
  );
});

UnsubscribeEventRender.displayName = 'McpEventsUnsubscribeEventRender';

export default UnsubscribeEventRender;

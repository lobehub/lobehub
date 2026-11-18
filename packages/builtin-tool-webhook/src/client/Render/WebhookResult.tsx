'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';

import { WebhookApiName, type WebhookState } from '../../types';
import ManageLink from '../components/ManageLink';
import ToolError from '../components/ToolError';
import WebhookCard from '../components/WebhookCard';
import { getToolError } from '../toolError';

/**
 * The webhook a call created or changed. Right after creating one, the card is where the
 * user issues its first key: the agent never sees it.
 */
const WebhookResultRender = ({
  apiName,
  pluginError,
  pluginState,
}: BuiltinRenderProps<unknown, WebhookState>) => {
  const error = getToolError(pluginState, pluginError);
  if (error) return <ToolError error={error} />;

  const webhook = pluginState?.webhook;
  if (!webhook) return null;

  return (
    <Flexbox gap={10} paddingBlock={4}>
      <WebhookCard
        keyAction={apiName === WebhookApiName.createWebhook ? 'first' : undefined}
        webhook={webhook}
      />
      {webhook.agentId && <ManageLink agentId={webhook.agentId} />}
    </Flexbox>
  );
};

export default WebhookResultRender;

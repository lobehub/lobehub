'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import type { SubscribeEventArgs, SubscribeEventState } from '../../types';
import ManageLink from '../components/ManageLink';
import SubscriptionSummary from '../components/SubscriptionSummary';
import ToolError from '../components/ToolError';
import { getToolError } from '../toolError';

/**
 * The subscription the user just approved: whether it took, how long it
 * lasts, and where to find it later. A failure names its cause instead.
 */
const SubscribeEventRender = memo<BuiltinRenderProps<SubscribeEventArgs, SubscribeEventState>>(
  ({ pluginError, pluginState }) => {
    const error = getToolError(pluginState, pluginError);
    if (error) return <ToolError error={error} />;

    const subscription = pluginState?.subscription;
    if (!subscription) return null;

    return (
      <Flexbox gap={10} paddingBlock={4}>
        <SubscriptionSummary detailed subscription={subscription} />
        <ManageLink />
      </Flexbox>
    );
  },
);

SubscribeEventRender.displayName = 'McpEventsSubscribeEventRender';

export default SubscribeEventRender;

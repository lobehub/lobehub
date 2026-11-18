'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';

import type { SubscriptionIdArgs, SubscriptionState } from '../../types';
import ManageLink from '../components/ManageLink';
import SubscriptionSummary from '../components/SubscriptionSummary';
import ToolError from '../components/ToolError';
import { getToolError } from '../toolError';

/**
 * The subscription a rename or a check left behind: its name, what it follows and how it is
 * doing now, with the reason line when something is wrong. A failure names its cause instead.
 */
const SubscriptionResultRender = ({
  pluginError,
  pluginState,
}: BuiltinRenderProps<SubscriptionIdArgs, SubscriptionState>) => {
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
};

export default SubscriptionResultRender;

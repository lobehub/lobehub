'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ListSubscriptionsState } from '../../types';
import ManageLink from '../components/ManageLink';
import SubscriptionSummary from '../components/SubscriptionSummary';
import ToolError from '../components/ToolError';
import { getToolError } from '../toolError';

const styles = stylex.create({
  row: {
    paddingBlock: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: { 'default': cssVar.colorBorderSecondary, ':last-child': 'transparent' },
  },
});

/** The subscriptions of this topic, one line each, with the way to manage them. */
const ListSubscriptionsRender = memo<BuiltinRenderProps<unknown, ListSubscriptionsState>>(
  ({ pluginError, pluginState }) => {
    const { t } = useTranslation('plugin');
    const error = getToolError(pluginState, pluginError);
    if (error) return <ToolError error={error} />;
    if (!pluginState?.subscriptions) return null;

    const { subscriptions } = pluginState;
    if (subscriptions.length === 0)
      return (
        <Text style={{ fontSize: 13 }} type={'secondary'}>
          {t('builtins.lobe-mcp-events.render.listEmpty')}
        </Text>
      );

    return (
      <Flexbox gap={6} paddingBlock={4}>
        <Flexbox>
          {subscriptions.map((subscription) => (
            <div key={subscription.id} {...stylex.props(styles.row)}>
              <SubscriptionSummary subscription={subscription} />
            </div>
          ))}
        </Flexbox>
        <ManageLink />
      </Flexbox>
    );
  },
);

ListSubscriptionsRender.displayName = 'McpEventsListSubscriptionsRender';

export default ListSubscriptionsRender;

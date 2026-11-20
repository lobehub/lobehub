'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import type { ListWebhooksState } from '../../types';
import ManageLink from '../components/ManageLink';
import ToolError from '../components/ToolError';
import WebhookCard from '../components/WebhookCard';
import { getToolError } from '../toolError';

const styles = stylex.create({
  row: {
    paddingBlock: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: { 'default': cssVar.colorBorderSecondary, ':last-child': 'transparent' },
  },
});

/** The agent's custom webhooks, one card each, offering a new key to their creator. */
const ListWebhooksRender = ({
  pluginError,
  pluginState,
}: BuiltinRenderProps<unknown, ListWebhooksState>) => {
  const { t } = useTranslation('plugin');
  const error = getToolError(pluginState, pluginError);
  if (error) return <ToolError error={error} />;
  if (!pluginState?.webhooks) return null;

  const { webhooks } = pluginState;
  const agentId = webhooks.find((webhook) => webhook.agentId)?.agentId;

  return (
    <Flexbox gap={6} paddingBlock={4}>
      {webhooks.length === 0 ? (
        <Text style={{ fontSize: 13 }} type={'secondary'}>
          {t('builtins.lobe-webhook.render.listEmpty')}
        </Text>
      ) : (
        <Flexbox>
          {webhooks.map((webhook) => (
            <div key={webhook.id} {...stylex.props(styles.row)}>
              <WebhookCard keyAction={'new'} webhook={webhook} />
            </div>
          ))}
        </Flexbox>
      )}
      {agentId && <ManageLink agentId={agentId} />}
    </Flexbox>
  );
};

export default ListWebhooksRender;

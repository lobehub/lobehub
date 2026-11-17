'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Alert, Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import type { WebhookIdArgs } from '../../types';
import { useWebhookTarget } from '../components/useWebhookTarget';

/**
 * Approval for deleting a webhook, said for what it is: a custom webhook stops taking calls at
 * once; an MCP Events subscription is also ended on its MCP server. The row is read from the
 * server; until it loads, the card states both outcomes.
 */
const DeleteWebhookIntervention = ({ args }: BuiltinInterventionProps<WebhookIdArgs>) => {
  const { t } = useTranslation('plugin');
  const { t: tAgent } = useTranslation('agent');
  const { data: target } = useWebhookTarget(args?.webhookId);
  const name =
    target?.name?.trim() ||
    (target?.source.kind === 'mcp_events' ? target.source.eventName : undefined) ||
    tAgent('webhook.defaultName');

  return (
    <Flexbox gap={8} paddingBlock={4}>
      {target && <Text weight={500}>{name}</Text>}
      <Alert
        showIcon
        title={t('builtins.lobe-webhook.intervention.deleteTitle')}
        type={'warning'}
        variant={'borderless'}
        description={t(
          target?.kind === 'mcp_events'
            ? 'builtins.lobe-webhook.intervention.deleteSubscriptionDesc'
            : target?.kind === 'generic'
              ? 'builtins.lobe-webhook.intervention.deleteWebhookDesc'
              : 'builtins.lobe-webhook.intervention.deleteDesc',
        )}
      />
    </Flexbox>
  );
};

export default DeleteWebhookIntervention;

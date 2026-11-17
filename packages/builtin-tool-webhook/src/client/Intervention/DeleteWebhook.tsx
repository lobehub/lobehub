'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Alert, Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import type { WebhookIdArgs } from '../../types';
import { useWebhookTarget } from '../components/useWebhookTarget';

/**
 * Approval for deleting a custom webhook: which one (read from the server, not the model's
 * arguments), and that its URL stops taking calls at once.
 */
const DeleteWebhookIntervention = ({ args }: BuiltinInterventionProps<WebhookIdArgs>) => {
  const { t } = useTranslation('plugin');
  const { t: tAgent } = useTranslation('agent');
  const { data: target } = useWebhookTarget(args?.webhookId);
  const name = target?.name?.trim() || tAgent('webhook.defaultName');

  return (
    <Flexbox gap={8} paddingBlock={4}>
      {target && <Text weight={500}>{name}</Text>}
      <Alert
        showIcon
        description={t('builtins.lobe-webhook.intervention.deleteWebhookDesc')}
        title={t('builtins.lobe-webhook.intervention.deleteTitle')}
        type={'warning'}
        variant={'borderless'}
      />
    </Flexbox>
  );
};

export default DeleteWebhookIntervention;

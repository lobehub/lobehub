'use client';

import type { BuiltinInterventionProps, InboundWebhookItem } from '@lobechat/types';
import { Alert, Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { inboundWebhookService } from '@/services/inboundWebhook';

import type { UnsubscribeEventArgs } from '../../types';

/** SWR key of the subscription an approval card is about; the workspace is added by the hook. */
const SUBSCRIPTION_TARGET_SWR_KEY = 'lobe-mcp-events-target';

/**
 * Approval for ending a subscription. It can be in any topic of the agent, so the card names it
 * as the server has it (its name, connector, event and where it runs), not as the model put it.
 */
const UnsubscribeEventIntervention = ({ args }: BuiltinInterventionProps<UnsubscribeEventArgs>) => {
  const { t } = useTranslation('plugin');
  const id = args?.subscriptionId;
  const { data: target } = useClientDataSWR<InboundWebhookItem>(
    id ? [SUBSCRIPTION_TARGET_SWR_KEY, id] : null,
    () => inboundWebhookService.get(id!),
    { revalidateOnFocus: false },
  );
  const event = target?.source.kind === 'mcp_events' ? target.source.eventName : undefined;
  const detail = [target?.connector?.name, event, target?.topic?.title?.trim()]
    .filter(Boolean)
    .join(' · ');

  return (
    <Flexbox gap={8} paddingBlock={4}>
      {target && (
        <Flexbox gap={2}>
          <Text weight={500}>{target.name?.trim() || event}</Text>
          {detail && (
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {detail}
            </Text>
          )}
        </Flexbox>
      )}
      <Alert
        showIcon
        description={t('builtins.lobe-mcp-events.intervention.unsubscribeDesc')}
        title={t('builtins.lobe-mcp-events.intervention.unsubscribeTitle')}
        type={'warning'}
        variant={'borderless'}
      />
    </Flexbox>
  );
};

export default UnsubscribeEventIntervention;

'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Alert, Flexbox } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import type { CreateWebhookArgs } from '../../types';
import { NoApprovalWarning, postsToChannel, Row, useDestinationLabel } from './shared';

/**
 * Approval for a standing entry point, not a one-off call: what the webhook will be called, what
 * each call will do, where its answers go, and what saying yes allows — every call runs the agent
 * and uses credits, and with auto-approve (always, for a Channel) anyone with the key makes the
 * agent use tools unasked. The key itself is issued afterwards, by the user, from the result.
 */
const CreateWebhookIntervention = ({ args }: BuiltinInterventionProps<CreateWebhookArgs>) => {
  const { t } = useTranslation('plugin');
  const { t: tAgent } = useTranslation('agent');
  const destination = useDestinationLabel();
  const channel = postsToChannel(args?.deliverTo);

  return (
    <Flexbox gap={4} paddingBlock={4}>
      <Row label={t('builtins.lobe-webhook.intervention.name')}>
        {args?.name?.trim() || tAgent('webhook.defaultName')}
      </Row>
      <Row label={t('builtins.lobe-webhook.intervention.instructions')}>
        {args?.instructions?.trim()}
      </Row>
      <Row label={t('builtins.lobe-webhook.intervention.topicMode')}>
        {tAgent(args?.topicMode === 'reuse' ? 'webhook.topicMode.reuse' : 'webhook.topicMode.new')}
      </Row>
      <Row label={t('builtins.lobe-webhook.intervention.destination.label')}>
        {destination(args?.deliverTo)}
      </Row>
      {(channel || args?.autoApprove) && <NoApprovalWarning channel={channel} />}
      <Alert
        showIcon
        description={t('builtins.lobe-webhook.intervention.createDesc')}
        title={t('builtins.lobe-webhook.intervention.createTitle')}
        type={'info'}
        variant={'borderless'}
      />
    </Flexbox>
  );
};

export default CreateWebhookIntervention;

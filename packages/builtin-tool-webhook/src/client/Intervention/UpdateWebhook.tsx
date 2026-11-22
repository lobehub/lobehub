'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import type { UpdateWebhookArgs } from '../../types';
import { useWebhookTarget } from '../components/useWebhookTarget';
import { NoApprovalWarning, postsToChannel, Row, useDestinationLabel } from './shared';

/**
 * Approval for changing a webhook: which one (read from the server, not the model), then only the
 * settings that change, then what saying yes allows when it turns on runs without approval.
 */
const UpdateWebhookIntervention = ({ args }: BuiltinInterventionProps<UpdateWebhookArgs>) => {
  const { t } = useTranslation('plugin');
  const { t: tAgent } = useTranslation('agent');
  const destination = useDestinationLabel();
  const { data: target } = useWebhookTarget(args?.webhookId);
  const channel = postsToChannel(args?.deliverTo);
  const onOff = (value: boolean) =>
    t(value ? 'builtins.lobe-webhook.intervention.on' : 'builtins.lobe-webhook.intervention.off');

  return (
    <Flexbox gap={4} paddingBlock={4}>
      <Flexbox paddingBlock={'0 8px'}>
        <Text weight={500}>{target?.name?.trim() || tAgent('webhook.defaultName')}</Text>
      </Flexbox>
      {args?.name !== undefined && (
        <Row label={t('builtins.lobe-webhook.intervention.name')}>{args.name}</Row>
      )}
      {args?.instructions !== undefined && (
        <Row label={t('builtins.lobe-webhook.intervention.instructions')}>{args.instructions}</Row>
      )}
      {args?.topicMode !== undefined && (
        <Row label={t('builtins.lobe-webhook.intervention.topicMode')}>
          {tAgent(args.topicMode === 'reuse' ? 'webhook.topicMode.reuse' : 'webhook.topicMode.new')}
        </Row>
      )}
      {args?.deliverTo !== undefined && (
        <Row label={t('builtins.lobe-webhook.intervention.destination.label')}>
          {destination(args.deliverTo)}
        </Row>
      )}
      {(args?.autoApprove !== undefined || channel) && (
        <Row label={t('builtins.lobe-webhook.intervention.autoApprove')}>
          {onOff(channel || !!args?.autoApprove)}
        </Row>
      )}
      {args?.paused !== undefined && (
        <Row label={t('builtins.lobe-webhook.intervention.state')}>
          {t(
            args.paused
              ? 'builtins.lobe-webhook.intervention.pause'
              : 'builtins.lobe-webhook.intervention.resume',
          )}
        </Row>
      )}
      {(channel || args?.autoApprove) && <NoApprovalWarning channel={channel} />}
    </Flexbox>
  );
};

export default UpdateWebhookIntervention;

'use client';

import { Button, cssVar, Flexbox, Input, toast } from '@lobehub/ui';
import { Form, type FormInstance, useWatch } from '@lobehub/ui/form';
import { Copy } from 'lucide-react';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import type { ChannelFormValues } from './index';
import { CHANNEL_INPUT_MIN_WIDTH } from './SchemaField';

interface WebhookUrlFieldProps {
  form: FormInstance<ChannelFormValues>;
  platformDef: SerializedPlatformDefinition;
}

/**
 * The URL the platform must call, shown in the connection card next to the
 * credentials it belongs with. Only webhook-mode platforms need it.
 */
const WebhookUrlField = memo<WebhookUrlFieldProps>(({ form, platformDef }) => {
  const { t } = useTranslation('agent');
  const origin = useAppOrigin();
  const applicationId = useWatch(form, 'applicationId');
  const connectionMode = useWatch(form, 'settings.connectionMode');

  if (!platformDef.showWebhookUrl && connectionMode !== 'webhook') return null;

  const webhookUrl = applicationId
    ? `${origin}/api/agent/webhooks/${platformDef.id}/${applicationId}`
    : `${origin}/api/agent/webhooks/${platformDef.id}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(webhookUrl);
    toast.success(t('channel.copied'));
  };

  return (
    <Form.Field
      divider
      label={t('channel.endpointUrl')}
      minWidth={CHANNEL_INPUT_MIN_WIDTH}
      desc={
        <Trans<'channel.endpointUrlHint', 'agent'>
          components={{ bold: <strong /> }}
          i18nKey="channel.endpointUrlHint"
          ns="agent"
          values={{ fieldName: 'Event Subscription URL', name: platformDef.name }}
        />
      }
    >
      <Flexbox horizontal gap={8} style={{ width: '100%' }}>
        <Input readOnly style={{ flex: 1, fontFamily: cssVar.fontFamilyCode }} value={webhookUrl} />
        <Button icon={<Copy size={14} />} onClick={handleCopy}>
          {t('channel.copy')}
        </Button>
      </Flexbox>
    </Form.Field>
  );
});

WebhookUrlField.displayName = 'ChannelWebhookUrlField';

export default WebhookUrlField;

'use client';

import { Button, confirmModal, Flexbox, toast } from '@lobehub/ui';
import { KeyRoundIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { KeyReveal } from '@/features/AgentWebhook/KeyReveal';
import { inboundWebhookService } from '@/services/inboundWebhook';

interface KeyIssuerProps {
  /** The webhook was just created: its key was never shown, so this is its first one. */
  first?: boolean;
  webhookId: string;
}

/**
 * Issues a webhook key from the browser, never through the agent: the key is shown here once,
 * held in this component's state only, and never written back to the conversation (tool results
 * are stored in plain text). Issuing replaces any earlier key, so it asks first.
 */
const KeyIssuer = ({ first, webhookId }: KeyIssuerProps) => {
  const { t } = useTranslation('plugin');
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<{ endpoint: string; secret: string }>();

  const issue = () =>
    confirmModal({
      cancelText: t('builtins.lobe-webhook.key.cancel'),
      content: t('builtins.lobe-webhook.key.confirmContent'),
      okButtonProps: { danger: true },
      okText: t('builtins.lobe-webhook.key.confirmOk'),
      onOk: async () => {
        setIssuing(true);
        try {
          const rotated = await inboundWebhookService.rotateToken(webhookId);
          if (rotated.item.endpoint)
            setIssued({ endpoint: rotated.item.endpoint, secret: rotated.secret });
        } catch {
          toast.error(t('builtins.lobe-webhook.key.failed'));
        } finally {
          setIssuing(false);
        }
      },
      title: t('builtins.lobe-webhook.key.confirmTitle'),
    });

  if (issued)
    return (
      <Flexbox gap={12}>
        <KeyReveal endpoint={issued.endpoint} secret={issued.secret} />
        <Button
          size={'small'}
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setIssued(undefined)}
        >
          {t('builtins.lobe-webhook.key.hide')}
        </Button>
      </Flexbox>
    );

  return (
    <Button
      icon={KeyRoundIcon}
      loading={issuing}
      size={'small'}
      style={{ alignSelf: 'flex-start' }}
      type={first ? 'primary' : 'default'}
      onClick={issue}
    >
      {t(first ? 'builtins.lobe-webhook.key.generate' : 'builtins.lobe-webhook.key.regenerate')}
    </Button>
  );
};

export default KeyIssuer;

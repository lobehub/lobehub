'use client';

import { Button, toast } from '@lobehub/ui';
import { useFormInstance } from '@lobehub/ui/form';
import { KeyRound } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { PlatformCredentialExtrasProps } from '../types';

/** 32 random bytes as hex: a signing secret both sides can paste anywhere. */
export const generateSigningSecret = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const CredentialExtras = memo<PlatformCredentialExtrasProps>(({ disabled }) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;
  const form = useFormInstance();

  const handleGenerate = () => {
    if (disabled) return;
    form.setValue('credentials.signingSecret', generateSigningSecret());
    // Mark the field validated and dirty so the save button picks the new value up.
    void form.validate(['credentials.signingSecret']);
    toast.success(t('channel.webhook.generateSecretSuccess'));
  };

  return (
    <Button
      disabled={disabled}
      icon={<KeyRound size={14} />}
      size="small"
      style={{ alignSelf: 'flex-start', marginBlockEnd: 12 }}
      type="default"
      onClick={handleGenerate}
    >
      {t('channel.webhook.generateSecret')}
    </Button>
  );
});

export default CredentialExtras;

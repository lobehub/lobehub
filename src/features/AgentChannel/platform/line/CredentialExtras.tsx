'use client';

import { isMaskedBotCredential } from '@lobechat/const';
import { Button, toast } from '@lobehub/ui';
import { useFormInstance, useWatch } from '@lobehub/ui/form';
import { Download } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineErrorText from '@/components/InlineErrorText';
import { useAgentStore } from '@/store/agent';

import type { PlatformCredentialExtrasProps } from '../types';

const CredentialExtras = memo<PlatformCredentialExtrasProps>(({ disabled }) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;

  const form = useFormInstance();
  const channelAccessToken = useWatch(form, 'credentials.channelAccessToken') as string | undefined;
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<{ detail: string; summary: string } | null>(null);

  const lineFetchBotInfo = useAgentStore((s) => s.lineFetchBotInfo);

  const handleFetch = async () => {
    if (disabled) return;

    const token = channelAccessToken?.trim();
    // A masked token is the server telling us it will not hand the secret back,
    // not a token — spending it here just fails authentication at LINE.
    if (!token || isMaskedBotCredential(token)) {
      toast.warning(t('channel.line.fetchBotInfoMissingToken'));
      return;
    }
    setLoading(true);
    setFetchError(null);
    try {
      const info = await lineFetchBotInfo(token);
      form.setValue('applicationId', info.userId);
      // Trigger validation/dirty state on the field so the form save button
      // recognises the auto-filled value as a real change.
      void form.validate(['applicationId']);
      toast.success(
        info.displayName
          ? `${t('channel.line.fetchBotInfoSuccess')} (${info.displayName})`
          : t('channel.line.fetchBotInfoSuccess'),
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      console.error('[LINE] Failed to fetch bot info:', error);
      setFetchError({ detail: text, summary: t('channel.line.fetchBotInfoFailedRetry') });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        icon={<Download size={14} />}
        loading={loading}
        size="small"
        style={{ alignSelf: 'flex-start', marginBlockEnd: 12 }}
        type="default"
        disabled={
          disabled || !channelAccessToken?.trim() || isMaskedBotCredential(channelAccessToken)
        }
        onClick={handleFetch}
      >
        {t('channel.line.fetchBotInfo')}
      </Button>
      {fetchError && (
        <div style={{ marginBlockEnd: 12 }}>
          <InlineErrorText detail={fetchError.detail}>{fetchError.summary}</InlineErrorText>
        </div>
      )}
    </>
  );
});

export default CredentialExtras;

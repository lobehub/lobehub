'use client';

import { isMaskedBotCredential } from '@lobechat/const';
import { Button, toast } from '@lobehub/ui/base-ui';
import { Form as AntdForm } from 'antd';
import { Download } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';

import type { PlatformCredentialExtrasProps } from '../types';

const CredentialExtras = memo<PlatformCredentialExtrasProps>(({ disabled }) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;

  const form = AntdForm.useFormInstance();
  const channelAccessToken = AntdForm.useWatch(['credentials', 'channelAccessToken'], form) as
    string | undefined;
  const [loading, setLoading] = useState(false);

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
    try {
      const info = await lineFetchBotInfo(token);
      form.setFieldValue('applicationId', info.userId);
      // Trigger validation/dirty state on the field so the form save button
      // recognises the auto-filled value as a real change.
      form.validateFields(['applicationId']).catch(() => undefined);
      toast.success(
        info.displayName
          ? `${t('channel.line.fetchBotInfoSuccess')} (${info.displayName})`
          : t('channel.line.fetchBotInfoSuccess'),
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      toast.error(`${t('channel.line.fetchBotInfoFailed')}: ${text}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      icon={<Download size={14} />}
      loading={loading}
      size="small"
      style={{ alignSelf: 'flex-start', marginBlockStart: 4 }}
      type="default"
      disabled={
        disabled || !channelAccessToken?.trim() || isMaskedBotCredential(channelAccessToken)
      }
      onClick={handleFetch}
    >
      {t('channel.line.fetchBotInfo')}
    </Button>
  );
});

export default CredentialExtras;

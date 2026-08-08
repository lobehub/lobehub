'use client';

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
    if (!token) {
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
      disabled={disabled || !channelAccessToken?.trim()}
      icon={<Download size={14} />}
      loading={loading}
      size="small"
      style={{ alignSelf: 'flex-start', marginBlockStart: 4 }}
      type="default"
      onClick={handleFetch}
    >
      {t('channel.line.fetchBotInfo')}
    </Button>
  );
});

export default CredentialExtras;

'use client';

import { App, Button, Form as AntdForm } from 'antd';
import { Download } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';

const CredentialExtras = memo(() => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;
  const { message } = App.useApp();
  const form = AntdForm.useFormInstance();
  const channelAccessToken = AntdForm.useWatch(['credentials', 'channelAccessToken'], form) as
    | string
    | undefined;
  const [loading, setLoading] = useState(false);

  const lineFetchBotInfo = useAgentStore((s) => s.lineFetchBotInfo);

  const handleFetch = async () => {
    const token = channelAccessToken?.trim();
    if (!token) {
      message.warning(t('channel.line.fetchBotInfoMissingToken'));
      return;
    }
    setLoading(true);
    try {
      const info = await lineFetchBotInfo(token);
      form.setFieldValue('applicationId', info.userId);
      // Trigger validation/dirty state on the field so the form save button
      // recognises the auto-filled value as a real change.
      form.validateFields(['applicationId']).catch(() => undefined);
      message.success(
        info.displayName
          ? `${t('channel.line.fetchBotInfoSuccess')} (${info.displayName})`
          : t('channel.line.fetchBotInfoSuccess'),
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      message.error(`${t('channel.line.fetchBotInfoFailed')}: ${text}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      disabled={!channelAccessToken?.trim()}
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

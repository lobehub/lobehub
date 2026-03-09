'use client';

import { App, Form } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';

import { type ChannelProvider } from '../const';
import Body from './Body';

const styles = createStaticStyles(({ css, cssVar }) => ({
  main: css`
    position: relative;

    overflow-y: auto;
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;

    background: ${cssVar.colorBgContainer};
  `,
}));

interface CurrentConfig {
  applicationId: string;
  credentials: Record<string, string>;
  enabled: boolean;
  id: string;
  platform: string;
}

export interface ChannelFormValues {
  applicationId: string;
  appSecret?: string;
  botToken: string;
  encryptKey?: string;
  publicKey: string;
  secretToken?: string;
  verificationToken?: string;
  webhookProxyUrl?: string;
}

export interface TestResult {
  errorDetail?: string;
  type: 'success' | 'error';
}

interface PlatformDetailProps {
  agentId: string;
  currentConfig?: CurrentConfig;
  provider: ChannelProvider;
}

const PlatformDetail = memo<PlatformDetailProps>(({ provider, agentId, currentConfig }) => {
  const { t } = useTranslation('agent');
  const { message: msg, modal } = App.useApp();
  const [form] = Form.useForm<ChannelFormValues>();

  const [createBotProvider, deleteBotProvider, updateBotProvider, connectBot] = useAgentStore(
    (s) => [s.createBotProvider, s.deleteBotProvider, s.updateBotProvider, s.connectBot],
  );

  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<TestResult>();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>();

  // Reset form when switching platforms
  useEffect(() => {
    form.resetFields();
  }, [provider.id, form]);

  // Sync form with saved config
  useEffect(() => {
    if (currentConfig) {
      form.setFieldsValue({
        applicationId: currentConfig.applicationId || '',
        appSecret: currentConfig.credentials?.appSecret || '',
        botToken: currentConfig.credentials?.botToken || '',
        encryptKey: currentConfig.credentials?.encryptKey || '',
        publicKey: currentConfig.credentials?.publicKey || '',
        secretToken: currentConfig.credentials?.secretToken || '',
        verificationToken: currentConfig.credentials?.verificationToken || '',
        webhookProxyUrl: currentConfig.credentials?.webhookProxyUrl || '',
      });
    }
  }, [currentConfig, form]);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();

      setSaving(true);
      setSaveResult(undefined);

      // Auto-derive applicationId from bot token for Telegram
      let applicationId = values.applicationId;
      if (provider.autoAppId && values.botToken) {
        const colonIdx = values.botToken.indexOf(':');
        if (colonIdx !== -1) {
          applicationId = values.botToken.slice(0, colonIdx);
          form.setFieldValue('applicationId', applicationId);
        }
      }

      // Build platform-specific credentials
      const credentials: Record<string, string> =
        provider.authMode === 'app-secret'
          ? { appId: applicationId, appSecret: values.appSecret || '' }
          : { botToken: values.botToken };

      if (provider.fieldTags.publicKey) {
        credentials.publicKey = values.publicKey || 'default';
      }
      if (provider.fieldTags.secretToken && values.secretToken) {
        credentials.secretToken = values.secretToken;
      }
      if (provider.fieldTags.verificationToken && values.verificationToken) {
        credentials.verificationToken = values.verificationToken;
      }
      if (provider.fieldTags.encryptKey && values.encryptKey) {
        credentials.encryptKey = values.encryptKey;
      }
      if (provider.webhookMode === 'auto' && values.webhookProxyUrl) {
        credentials.webhookProxyUrl = values.webhookProxyUrl;
      }

      if (currentConfig) {
        await updateBotProvider(currentConfig.id, agentId, {
          applicationId,
          credentials,
        });
      } else {
        await createBotProvider({
          agentId,
          applicationId,
          credentials,
          platform: provider.id,
        });
      }

      setSaveResult({ type: 'success' });
    } catch (e: any) {
      if (e?.errorFields) return;
      console.error(e);
      setSaveResult({ errorDetail: e?.message || String(e), type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [
    agentId,
    provider.id,
    provider.autoAppId,
    provider.authMode,
    provider.fieldTags,
    provider.webhookMode,
    form,
    currentConfig,
    createBotProvider,
    updateBotProvider,
  ]);

  const handleDelete = useCallback(async () => {
    if (!currentConfig) return;

    modal.confirm({
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteBotProvider(currentConfig.id, agentId);
          msg.success(t('channel.removed'));
          form.resetFields();
        } catch {
          msg.error(t('channel.removeFailed'));
        }
      },
      title: t('channel.deleteConfirm'),
    });
  }, [currentConfig, agentId, deleteBotProvider, msg, t, modal, form]);

  const handleToggleEnable = useCallback(
    async (enabled: boolean) => {
      if (!currentConfig) return;
      try {
        await updateBotProvider(currentConfig.id, agentId, { enabled });
      } catch {
        msg.error(t('channel.updateFailed'));
      }
    },
    [currentConfig, agentId, updateBotProvider, msg, t],
  );

  const handleTestConnection = useCallback(async () => {
    if (!currentConfig) {
      msg.warning(t('channel.saveFirstWarning'));
      return;
    }

    setTesting(true);
    setTestResult(undefined);
    try {
      await connectBot({
        applicationId: currentConfig.applicationId,
        platform: provider.id,
      });
      setTestResult({ type: 'success' });
    } catch (e: any) {
      setTestResult({
        errorDetail: e?.message || String(e),
        type: 'error',
      });
    } finally {
      setTesting(false);
    }
  }, [currentConfig, provider.id, connectBot, msg, t]);

  return (
    <main className={styles.main}>
      <Body
        currentConfig={currentConfig}
        form={form}
        hasConfig={!!currentConfig}
        provider={provider}
        saveResult={saveResult}
        saving={saving}
        testResult={testResult}
        testing={testing}
        onCopied={() => msg.success(t('channel.copied'))}
        onDelete={handleDelete}
        onSave={handleSave}
        onTestConnection={handleTestConnection}
        onToggleEnable={handleToggleEnable}
      />
    </main>
  );
});

export default PlatformDetail;

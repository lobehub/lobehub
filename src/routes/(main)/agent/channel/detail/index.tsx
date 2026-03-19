'use client';

import { App, Form } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';
import { useAgentStore } from '@/store/agent';

import Body from './Body';
import Footer from './Footer';
import Header from './Header';

const styles = createStaticStyles(({ css, cssVar }) => ({
  main: css`
    position: relative;

    overflow-y: auto;
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;

    padding: 24px;

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
  applicationId?: string;
  credentials: Record<string, string>;
  settings: Record<string, unknown>;
}

export interface TestResult {
  errorDetail?: string;
  type: 'error' | 'success';
}

interface PlatformDetailProps {
  agentId: string;
  currentConfig?: CurrentConfig;
  platformDef: SerializedPlatformDefinition;
}

const PlatformDetail = memo<PlatformDetailProps>(({ platformDef, agentId, currentConfig }) => {
  const { t } = useTranslation('agent');
  const { message: msg, modal } = App.useApp();
  const [form] = Form.useForm<ChannelFormValues>();

  const [createBotProvider, deleteBotProvider, updateBotProvider, connectBot, testConnection] =
    useAgentStore((s) => [
      s.createBotProvider,
      s.deleteBotProvider,
      s.updateBotProvider,
      s.connectBot,
      s.testConnection,
    ]);

  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [saveResult, setSaveResult] = useState<TestResult>();
  const [connectResult, setConnectResult] = useState<TestResult>();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>();

  // Reset form and status when switching platforms
  useEffect(() => {
    form.resetFields();
    setSaveResult(undefined);
    setConnectResult(undefined);
    setTestResult(undefined);
  }, [platformDef.id, form]);

  // Sync form with saved config
  useEffect(() => {
    if (currentConfig) {
      form.setFieldsValue({
        applicationId: currentConfig.applicationId || '',
        credentials: currentConfig.credentials || {},
      } as any);
    }
  }, [currentConfig, form]);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();

      setSaving(true);
      setSaveResult(undefined);
      setConnectResult(undefined);

      const {
        applicationId: formAppId,
        credentials: rawCredentials = {},
        settings = {},
      } = values as ChannelFormValues;

      // Strip undefined values from credentials (optional fields left empty by antd form)
      const credentials = Object.fromEntries(
        Object.entries(rawCredentials).filter(([, v]) => v !== undefined && v !== ''),
      );

      // Use explicit applicationId from form; fall back to deriving from botToken (Telegram)
      let applicationId = formAppId || '';
      if (!applicationId && (credentials as Record<string, string>).botToken) {
        const colonIdx = (credentials as Record<string, string>).botToken.indexOf(':');
        if (colonIdx !== -1)
          applicationId = (credentials as Record<string, string>).botToken.slice(0, colonIdx);
      }

      if (currentConfig) {
        await updateBotProvider(currentConfig.id, agentId, {
          applicationId,
          credentials,
          settings,
        });
      } else {
        await createBotProvider({
          agentId,
          applicationId,
          credentials,
          platform: platformDef.id,
          settings,
        });
      }

      setSaveResult({ type: 'success' });
      setSaving(false);

      // Auto-connect bot after save
      setConnecting(true);
      try {
        await connectBot({ applicationId, platform: platformDef.id });
        setConnectResult({ type: 'success' });
      } catch (e: any) {
        setConnectResult({ errorDetail: e?.message || String(e), type: 'error' });
      } finally {
        setConnecting(false);
      }
    } catch (e: any) {
      if (e?.errorFields) return;
      console.error(e);
      setSaveResult({ errorDetail: e?.message || String(e), type: 'error' });
      setSaving(false);
    }
  }, [agentId, platformDef, form, currentConfig, createBotProvider, updateBotProvider, connectBot]);

  const handleDelete = useCallback(async () => {
    if (!currentConfig) return;

    modal.confirm({
      content: t('channel.deleteConfirmDesc'),
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
        if (enabled) {
          await connectBot({
            applicationId: currentConfig.applicationId,
            platform: currentConfig.platform,
          });
        }
      } catch {
        msg.error(t('channel.updateFailed'));
      }
    },
    [currentConfig, agentId, updateBotProvider, connectBot, msg, t],
  );

  const handleTestConnection = useCallback(async () => {
    if (!currentConfig) {
      msg.warning(t('channel.saveFirstWarning'));
      return;
    }

    setTesting(true);
    setTestResult(undefined);
    try {
      await testConnection({
        applicationId: currentConfig.applicationId,
        platform: platformDef.id,
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
  }, [currentConfig, platformDef.id, testConnection, msg, t]);

  return (
    <main className={styles.main}>
      <Header
        currentConfig={currentConfig}
        platformDef={platformDef}
        onToggleEnable={handleToggleEnable}
      />
      <Body form={form} platformDef={platformDef} />
      <Footer
        connectResult={connectResult}
        connecting={connecting}
        form={form}
        hasConfig={!!currentConfig}
        platformDef={platformDef}
        saveResult={saveResult}
        saving={saving}
        testResult={testResult}
        testing={testing}
        onCopied={() => msg.success(t('channel.copied'))}
        onDelete={handleDelete}
        onSave={handleSave}
        onTestConnection={handleTestConnection}
      />
    </main>
  );
});

export default PlatformDetail;

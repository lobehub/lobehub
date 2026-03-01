'use client';

import { App, Form } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';

import { type IntegrationProvider } from '../const';
import Body from './Body';
import Header from './Header';

const styles = createStaticStyles(({ css, cssVar }) => ({
  main: css`
    position: relative;

    overflow-y: auto;
    display: flex;
    flex: 1;
    flex-direction: column;

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

export interface IntegrationFormValues {
  applicationId: string;
  botToken: string;
  publicKey: string;
}

export interface TestResult {
  errorDetail?: string;
  type: 'success' | 'error';
}

interface PlatformDetailProps {
  agentId: string;
  currentConfig?: CurrentConfig;
  provider: IntegrationProvider;
}

const PlatformDetail = memo<PlatformDetailProps>(({ provider, agentId, currentConfig }) => {
  const { t } = useTranslation('agent');
  const { message: msg, modal } = App.useApp();
  const [form] = Form.useForm<IntegrationFormValues>();

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
        botToken: currentConfig.credentials?.botToken || '',
        publicKey: currentConfig.credentials?.publicKey || '',
      });
    }
  }, [currentConfig, form]);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();

      setSaving(true);
      setSaveResult(undefined);

      const credentials = {
        botToken: values.botToken,
        publicKey: values.publicKey || 'default',
      };

      if (currentConfig) {
        await updateBotProvider(currentConfig.id, agentId, {
          applicationId: values.applicationId,
          credentials,
        });
      } else {
        await createBotProvider({
          agentId,
          applicationId: values.applicationId,
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
  }, [agentId, provider.id, form, currentConfig, createBotProvider, updateBotProvider]);

  const handleDelete = useCallback(async () => {
    if (!currentConfig) return;

    modal.confirm({
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteBotProvider(currentConfig.id, agentId);
          msg.success(t('integration.removed'));
          form.resetFields();
        } catch {
          msg.error(t('integration.removeFailed'));
        }
      },
      title: t('integration.deleteConfirm'),
    });
  }, [currentConfig, agentId, deleteBotProvider, msg, t, modal, form]);

  const handleToggleEnable = useCallback(
    async (enabled: boolean) => {
      if (!currentConfig) return;
      try {
        await updateBotProvider(currentConfig.id, agentId, { enabled });
      } catch {
        msg.error(t('integration.updateFailed'));
      }
    },
    [currentConfig, agentId, updateBotProvider, msg, t],
  );

  const handleTestConnection = useCallback(async () => {
    if (!currentConfig) {
      msg.warning(t('integration.saveFirstWarning'));
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
      <Header
        currentConfig={currentConfig}
        provider={provider}
        onToggleEnable={handleToggleEnable}
      />
      <Body
        form={form}
        hasConfig={!!currentConfig}
        provider={provider}
        saveResult={saveResult}
        saving={saving}
        testResult={testResult}
        testing={testing}
        onCopied={() => msg.success(t('integration.copied'))}
        onDelete={handleDelete}
        onSave={handleSave}
        onTestConnection={handleTestConnection}
      />
    </main>
  );
});

export default PlatformDetail;

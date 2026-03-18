'use client';

import { App, Form } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';
import { useAgentStore } from '@/store/agent';

import Body from './Body';

/**
 * Resolve applicationId from credentials by convention:
 * 1. Explicit `applicationId` field (Discord)
 * 2. `appId` field (Feishu, QQ)
 * 3. Derive from `botToken` before ':' (Telegram: "123456:ABC" → "123456")
 */
export function resolveApplicationId(credentials: Record<string, string>): string {
  if (credentials.applicationId) return credentials.applicationId;
  if (credentials.appId) return credentials.appId;

  if (credentials.botToken) {
    const colonIdx = credentials.botToken.indexOf(':');
    if (colonIdx !== -1) return credentials.botToken.slice(0, colonIdx);
  }

  return '';
}

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

export type ChannelFormValues = Record<string, string>;

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
  }, [platformDef.id, form]);

  // Sync form with saved config
  useEffect(() => {
    if (currentConfig) {
      const values: Record<string, string> = {
        applicationId: currentConfig.applicationId || '',
      };
      for (const field of platformDef.credentials) {
        values[field.key] = currentConfig.credentials?.[field.key] || '';
      }
      form.setFieldsValue(values);
    }
  }, [currentConfig, form, platformDef.credentials]);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();

      setSaving(true);
      setSaveResult(undefined);

      // Build credentials from platform definition
      const credentials: Record<string, string> = {};
      for (const field of platformDef.credentials) {
        const value = values[field.key];
        if (value) credentials[field.key] = value;
      }

      const applicationId = resolveApplicationId(credentials);

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
          platform: platformDef.id,
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
  }, [agentId, platformDef, form, currentConfig, createBotProvider, updateBotProvider]);

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
  }, [currentConfig, platformDef.id, connectBot, msg, t]);

  return (
    <main className={styles.main}>
      <Body
        currentConfig={currentConfig}
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
        onToggleEnable={handleToggleEnable}
      />
    </main>
  );
});

export default PlatformDetail;

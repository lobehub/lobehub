'use client';

import { App, Form } from 'antd';
import { createStyles } from 'antd-style';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentBotProviderService } from '@/services/agentBotProvider';

import { type IntegrationProvider } from '../const';
import Body from './Body';
import Header from './Header';

const useStyles = createStyles(({ css, token }) => ({
  main: css`
    position: relative;

    overflow-y: auto;
    display: flex;
    flex: 1;
    flex-direction: column;

    background: ${token.colorBgContainer};
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

interface PlatformDetailProps {
  agentId: string;
  currentConfig?: CurrentConfig;
  onMutate: () => void;
  provider: IntegrationProvider;
}

const PlatformDetail = memo<PlatformDetailProps>(
  ({ provider, agentId, currentConfig, onMutate }) => {
    const { t } = useTranslation('agent');
    const { message: msg, modal } = App.useApp();
    const { styles } = useStyles();
    const [form] = Form.useForm<IntegrationFormValues>();

    const [testing, setTesting] = useState(false);

    useEffect(() => {
      if (currentConfig) {
        form.setFieldsValue({
          applicationId: currentConfig.applicationId || '',
          botToken: currentConfig.credentials?.botToken || '',
          publicKey: currentConfig.credentials?.publicKey || '',
        });
      } else {
        form.resetFields();
      }
    }, [currentConfig, provider.id, form]);

    const handleSave = useCallback(async () => {
      try {
        const values = await form.validateFields();

        await agentBotProviderService.create({
          agentId,
          applicationId: values.applicationId,
          credentials: {
            botToken: values.botToken,
            publicKey: values.publicKey || 'default',
          },
          platform: provider.id,
        });

        onMutate();
        msg.success(t('integration.saved'));
      } catch (e: any) {
        if (e?.errorFields) {
          msg.error(t('integration.validationError'));
          return;
        }
        console.error(e);
        msg.error(t('integration.saveFailed'));
      }
    }, [agentId, provider.id, form, onMutate, msg, t]);

    const handleDelete = useCallback(async () => {
      if (!currentConfig) return;

      modal.confirm({
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await agentBotProviderService.delete(currentConfig.id);
            onMutate();
            msg.success(t('integration.removed'));
            form.resetFields();
          } catch {
            msg.error(t('integration.removeFailed'));
          }
        },
        title: t('integration.deleteConfirm'),
      });
    }, [currentConfig, onMutate, msg, t, modal, form]);

    const handleToggleEnable = useCallback(
      async (enabled: boolean) => {
        if (!currentConfig) return;
        try {
          await agentBotProviderService.update(currentConfig.id, { enabled });
          onMutate();
        } catch {
          msg.error(t('integration.updateFailed'));
        }
      },
      [currentConfig, onMutate, msg, t],
    );

    const handleTestConnection = useCallback(async () => {
      if (!currentConfig) {
        msg.warning(t('integration.saveFirstWarning'));
        return;
      }

      setTesting(true);
      try {
        await agentBotProviderService.connectBot({
          applicationId: currentConfig.applicationId,
          platform: provider.id,
        });
        msg.success(t('integration.testSuccess'));
      } catch {
        msg.error(t('integration.testFailed'));
      } finally {
        setTesting(false);
      }
    }, [currentConfig, provider.id, msg, t]);

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
          testing={testing}
          onCopied={() => msg.success(t('integration.copied'))}
          onDelete={handleDelete}
          onSave={handleSave}
          onTestConnection={handleTestConnection}
        />
      </main>
    );
  },
);

export default PlatformDetail;

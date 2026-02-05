import { Button, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { App,Form as AForm } from 'antd';
import { createStaticStyles } from 'antd-style';
import { EditIcon, LinkIcon, Settings2Icon, TerminalIcon } from 'lucide-react';
import { useImperativeHandle, useState } from 'react';
import { useTranslation } from 'react-i18next';

import KeyValueEditor from '@/components/KeyValueEditor';
import MCPStdioCommandInput from '@/components/MCPStdioCommandInput';
import ArgsInput from '@/features/PluginDevModal/MCPManifestForm/ArgsInput';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  compactForm: css`
    .ant-form-item {
      margin-block-end: ${cssVar.marginSM};
    }

    .ant-form-item-label {
      padding-block-end: ${cssVar.paddingXXS};

      label {
        height: auto;
        font-size: ${cssVar.fontSizeSM};
      }
    }
  `,

  configFormContainer: css`
    padding: ${cssVar.paddingLG};
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillAlter};
  `,

  configHeader: css`
    margin-block-end: ${cssVar.marginLG};

    h5 {
      margin-block-end: ${cssVar.marginXS} !important;
      color: ${cssVar.colorTextHeading};
    }
  `,

  connectionForm: css`
    padding: ${cssVar.paddingMD};
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillAlter};
  `,

  connectionPreview: css`
    padding: ${cssVar.paddingMD};
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillAlter};
  `,

  editButton: css`
    position: absolute;
    inset-block-start: ${cssVar.paddingXS};
    inset-inline-end: ${cssVar.paddingXS};
  `,

  emptyState: css`
    padding: ${cssVar.paddingXL};
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorTextTertiary};
    text-align: center;

    background: ${cssVar.colorFillQuaternary};
  `,

  footer: css`
    display: flex;
    gap: ${cssVar.marginSM};
    margin-block-start: ${cssVar.marginLG};
  `,

  markdown: css`
    p {
      margin-block-end: ${cssVar.marginXS};
      color: ${cssVar.colorTextDescription};
    }
  `,

  previewItem: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    padding-block: ${cssVar.paddingXS};
    padding-inline: 0;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,

  previewLabel: css`
    display: flex;
    gap: ${cssVar.marginXS};
    align-items: center;

    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,

  previewValue: css`
    padding-block: ${cssVar.paddingXXS};
    padding-inline: ${cssVar.paddingXS};

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-weight: 600;
    color: ${cssVar.colorText};

    background: ${cssVar.colorFillQuaternary};
  `,

  sectionTitle: css`
    position: relative;

    display: flex;
    gap: ${cssVar.marginXS};
    align-items: center;

    height: 32px;

    font-size: ${cssVar.fontSizeLG};
    font-weight: 600;
    color: ${cssVar.colorTextHeading};

    &::after {
      content: '';

      flex: 1;

      height: 1px;
      margin-inline-start: ${cssVar.marginMD};

      background: linear-gradient(to right, ${cssVar.colorBorder}, transparent);
    }
  `,
}));

export interface SettingsRef {
  reset: () => void;
  save: () => Promise<void>;
}

interface SettingsProps {
  hideFooter?: boolean;
  identifier: string;
}

const Settings = ({ ref, identifier, hideFooter }: SettingsProps & { ref?: React.RefObject<SettingsRef | null> }) => {
  const { t } = useTranslation(['plugin', 'common']);
  const [connectionForm] = AForm.useForm();
  const [envForm] = AForm.useForm();
  const [loading, setLoading] = useState(false);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [isEditingConnection, setIsEditingConnection] = useState(false);

  const [updatePluginSettings, updateInstallPlugin] = useToolStore((s) => [
    s.updatePluginSettings,
    s.updateInstallMcpPlugin,
  ]);
  const { message } = App.useApp();

  useImperativeHandle(ref, () => ({
    reset: () => {
      connectionForm.resetFields();
      envForm.resetFields();
      setIsEditingConnection(false);
    },
    save: async () => {
      if (isEditingConnection) {
        await connectionForm.submit();
      }
      await envForm.submit();
    },
  }));

  // 获取已安装插件信息
  const installedPlugin = useToolStore(pluginSelectors.getInstalledPluginById(identifier));
  const pluginSettings = useToolStore(pluginSelectors.getPluginSettingsById(identifier));

  if (!installedPlugin) {
    return null;
  }

  const customParams = installedPlugin.customParams?.mcp;
  const isStdioType = customParams?.type === 'stdio';

  const handleConnectionSubmit = async (values: any) => {
    setConnectionLoading(true);
    try {
      await updateInstallPlugin(identifier!, values);

      message.success(t('settings.messages.connectionUpdateSuccess'));
      setIsEditingConnection(false);
    } catch (error) {
      console.error('Connection update failed:', error);
      message.error(t('settings.messages.connectionUpdateFailed'));
    } finally {
      setConnectionLoading(false);
    }
  };

  const handleCancelEdit = () => {
    connectionForm.resetFields();
    setIsEditingConnection(false);
  };

  const handleEnvSubmit = async (values: { env?: Record<string, string> }) => {
    setLoading(true);
    try {
      await updatePluginSettings(identifier!, values.env || {}, { override: true });
      message.success(t('settings.messages.envUpdateSuccess'));
    } catch (error) {
      console.error('Settings update failed:', error);
      message.error(t('settings.messages.envUpdateFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox paddingBlock={8} paddingInline={12}>
      <Flexbox gap={24}>
        <Flexbox gap={24}>
          <div className={styles.sectionTitle}>
            <LinkIcon size={16} />
            {t('settings.connection.title')}
            {!isEditingConnection && (
              <Button
                className={styles.editButton}
                icon={<EditIcon size={12} />}
                size="small"
                type="text"
                onClick={() => setIsEditingConnection(true)}
              >
                {t('settings.edit')}
              </Button>
            )}
          </div>

          {!isEditingConnection ? (
            // 预览模式
            <Flexbox paddingInline={8}>
              <div className={styles.previewItem}>
                <span className={styles.previewLabel}>{t('settings.connection.type')}</span>
                <Flexbox horizontal>
                  <Icon icon={TerminalIcon} />
                  <Text className={styles.previewValue}>
                    {customParams?.type?.toUpperCase() || 'Unknown'}
                  </Text>
                </Flexbox>
              </div>

              {customParams?.type === 'http' && customParams?.url && (
                <div className={styles.previewItem}>
                  <span className={styles.previewLabel}>{t('settings.connection.url')}</span>
                  <span className={styles.previewValue}>{customParams.url}</span>
                </div>
              )}

              {customParams?.type === 'stdio' && (
                <>
                  {customParams?.command && (
                    <div className={styles.previewItem}>
                      <span className={styles.previewLabel}>
                        {t('settings.connection.command')}
                      </span>
                      <span className={styles.previewValue}>{customParams.command}</span>
                    </div>
                  )}

                  {customParams?.args && customParams.args.length > 0 && (
                    <div className={styles.previewItem}>
                      <span className={styles.previewLabel}>{t('settings.connection.args')}</span>
                      <span className={styles.previewValue}>{customParams.args.join(' ')}</span>
                    </div>
                  )}
                </>
              )}
            </Flexbox>
          ) : (
            // 编辑模式
            <div className={styles.connectionForm}>
              <AForm
                className={styles.compactForm}
                form={connectionForm}
                initialValues={customParams}
                layout="vertical"
                onFinish={handleConnectionSubmit}
              >
                {customParams?.type === 'http' && (
                  <AForm.Item
                    label={t('settings.connection.url')}
                    name={'url'}
                    rules={[{ message: t('settings.rules.urlRequired'), required: true }]}
                  >
                    <Input placeholder="https://mcp.example.com/server" size="small" />
                  </AForm.Item>
                )}

                {customParams?.type === 'stdio' && (
                  <>
                    <AForm.Item
                      label={t('settings.connection.command')}
                      name={'command'}
                      rules={[{ message: t('settings.rules.commandRequired'), required: true }]}
                    >
                      <MCPStdioCommandInput placeholder="npx, uv, python..." />
                    </AForm.Item>

                    <AForm.Item
                      label={t('settings.connection.args')}
                      name={'args'}
                      rules={[{ message: t('settings.rules.argsRequired'), required: true }]}
                    >
                      <ArgsInput placeholder="e.g: mcp-hello-world" />
                    </AForm.Item>
                  </>
                )}
                <Flexbox horizontal className={styles.footer} gap={8}>
                  <Button htmlType="submit" loading={connectionLoading} type="primary">
                    {t('common:save')}
                  </Button>
                  <Button onClick={handleCancelEdit}>{t('common:cancel')}</Button>
                </Flexbox>
              </AForm>
            </div>
          )}
        </Flexbox>

        {/* 环境变量配置（仅 stdio 类型） */}
        {isStdioType && (
          <Flexbox gap={12}>
            <div className={styles.sectionTitle}>
              <Settings2Icon size={16} />
              {t('settings.configuration.title')}
            </div>
            <Text style={{ fontSize: 12 }} type="secondary">
              {t('settings.envConfigDescription')}
            </Text>
            <AForm
              form={envForm}
              initialValues={{ env: pluginSettings }}
              layout="vertical"
              onFinish={handleEnvSubmit}
            >
              <AForm.Item name="env" style={{ marginBottom: 0 }}>
                <KeyValueEditor
                  addButtonText={t('dev.mcp.env.add')}
                  keyPlaceholder="VARIABLE_NAME"
                />
              </AForm.Item>
              {!hideFooter && (
                <Flexbox horizontal className={styles.footer} gap={8}>
                  <Button htmlType="submit" loading={loading} type="primary">
                    {t('common:save')}
                  </Button>
                  <Button onClick={() => envForm.resetFields()}>{t('common:reset')}</Button>
                </Flexbox>
              )}
            </AForm>
          </Flexbox>
        )}

        {/* HTTP 类型提示 */}
        {!isStdioType && (
          <div>
            <div className={styles.sectionTitle}>
              <Settings2Icon size={16} />
              {t('settings.configuration.title')}
            </div>
            <div className={styles.emptyState}>
              <Text type="secondary">{t('settings.httpTypeNotice')}</Text>
            </div>
          </div>
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default Settings;

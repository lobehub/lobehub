import { Button, Flexbox, Icon, Input, Text, toast } from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { EditIcon, LinkIcon, Settings2Icon, TerminalIcon } from 'lucide-react';
import { useImperativeHandle, useState } from 'react';
import { useTranslation } from 'react-i18next';

import KeyValueEditor from '@/components/KeyValueEditor';
import MCPStdioCommandInput from '@/components/MCPStdioCommandInput';
import ArgsInput from '@/features/PluginDevModal/MCPManifestForm/ArgsInput';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

const styles = stylex.create({
  connectionForm: {
    padding: cssVar.paddingMD,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillAlter,
    backgroundImage: 'none',
  },

  editButton: {
    position: 'absolute',
    insetBlockStart: cssVar.paddingXS,
    insetInlineEnd: cssVar.paddingXS,
  },

  emptyState: {
    padding: cssVar.paddingXL,
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusLG,
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },

  footer: {
    display: 'flex',
    gap: cssVar.marginSM,
    marginBlockStart: cssVar.marginLG,
  },

  previewItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: cssVar.paddingXS,
    paddingInline: 0,
    borderBlockEndWidth: { 'default': null, ':not(:last-child)': '1px' },
    borderBlockEndStyle: { 'default': null, ':not(:last-child)': 'solid' },
    borderBlockEndColor: { 'default': null, ':not(:last-child)': cssVar.colorBorderSecondary },
  },

  previewLabel: {
    display: 'flex',
    gap: cssVar.marginXS,
    alignItems: 'center',
    fontSize: cssVar.fontSizeSM,
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },

  previewValue: {
    paddingBlock: cssVar.paddingXXS,
    paddingInline: cssVar.paddingXS,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    fontWeight: 600,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },

  sectionTitle: {
    'position': 'relative',
    'display': 'flex',
    'gap': cssVar.marginXS,
    'alignItems': 'center',
    'height': '32px',
    'fontSize': cssVar.fontSizeLG,
    'fontWeight': 600,
    'color': cssVar.colorTextHeading,
    '::after': {
      content: '""',
      flex: '1',
      height: '1px',
      marginInlineStart: cssVar.marginMD,
      backgroundColor: 'transparent',
      backgroundImage: `linear-gradient(to right, ${cssVar.colorBorder}, transparent)`,
    },
  },
});

export interface SettingsRef {
  reset: () => void;
  save: () => Promise<void>;
}

interface ConnectionValues {
  args?: string[];
  command?: string;
  url?: string;
}

interface EnvValues {
  env?: Record<string, string>;
}

interface SettingsProps {
  hideFooter?: boolean;
  identifier: string;
}

const Settings = ({
  ref,
  identifier,
  hideFooter,
}: SettingsProps & { ref?: React.RefObject<SettingsRef | null> }) => {
  const { t } = useTranslation(['plugin', 'common']);
  const [loading, setLoading] = useState(false);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [isEditingConnection, setIsEditingConnection] = useState(false);

  const [updatePluginSettings, updateInstallPlugin] = useToolStore((s) => [
    s.updatePluginSettings,
    s.updateInstallMcpPlugin,
  ]);

  // Get installed plugin info
  const installedPlugin = useToolStore(pluginSelectors.getInstalledPluginById(identifier));
  const pluginSettings = useToolStore(pluginSelectors.getPluginSettingsById(identifier));

  const customParams = installedPlugin?.customParams?.mcp;
  const isStdioType = customParams?.type === 'stdio';

  const getConnectionValues = (): ConnectionValues => ({
    args: customParams?.args,
    command: customParams?.command,
    url: customParams?.url,
  });

  const handleConnectionSubmit = async (values: ConnectionValues) => {
    setConnectionLoading(true);
    try {
      await updateInstallPlugin(identifier!, values);

      toast.success(t('settings.messages.connectionUpdateSuccess'));
      setIsEditingConnection(false);
    } catch (error) {
      console.error('Connection update failed:', error);
      toast.error(t('settings.messages.connectionUpdateFailed'));
    } finally {
      setConnectionLoading(false);
    }
  };

  const handleEnvSubmit = async (values: EnvValues) => {
    setLoading(true);
    try {
      await updatePluginSettings(identifier!, values.env || {}, { override: true });
      toast.success(t('settings.messages.envUpdateSuccess'));
    } catch (error) {
      console.error('Settings update failed:', error);
      toast.error(t('settings.messages.envUpdateFailed'));
    } finally {
      setLoading(false);
    }
  };

  const connectionForm = useForm<ConnectionValues>({
    initialValues: getConnectionValues(),
    onSubmit: handleConnectionSubmit,
  });
  const envForm = useForm<EnvValues>({
    initialValues: { env: pluginSettings },
    onSubmit: handleEnvSubmit,
  });

  const resetEnvForm = () => envForm.reset({ env: pluginSettings });

  const handleStartEdit = () => {
    connectionForm.reset(getConnectionValues());
    setIsEditingConnection(true);
  };

  const handleCancelEdit = () => {
    connectionForm.reset(getConnectionValues());
    setIsEditingConnection(false);
  };

  useImperativeHandle(ref, () => ({
    reset: () => {
      connectionForm.reset(getConnectionValues());
      resetEnvForm();
      setIsEditingConnection(false);
    },
    save: async () => {
      if (isEditingConnection) {
        await connectionForm.submit();
      }
      await envForm.submit();
    },
  }));

  if (!installedPlugin) {
    return null;
  }

  return (
    <Flexbox paddingBlock={8} paddingInline={12}>
      <Flexbox gap={24}>
        <Flexbox gap={24}>
          <div {...stylex.props(styles.sectionTitle)}>
            <LinkIcon size={16} />
            {t('settings.connection.title')}
            {!isEditingConnection && (
              <Button
                className={stylex.props(styles.editButton).className}
                icon={<EditIcon size={12} />}
                size="small"
                type="text"
                onClick={handleStartEdit}
              >
                {t('settings.edit')}
              </Button>
            )}
          </div>

          {!isEditingConnection ? (
            // Preview mode
            <Flexbox paddingInline={8}>
              <div {...stylex.props(styles.previewItem)}>
                <span {...stylex.props(styles.previewLabel)}>{t('settings.connection.type')}</span>
                <Flexbox horizontal>
                  <Icon icon={TerminalIcon} />
                  <Text className={stylex.props(styles.previewValue).className}>
                    {customParams?.type?.toUpperCase() || 'Unknown'}
                  </Text>
                </Flexbox>
              </div>

              {customParams?.type === 'http' && customParams?.url && (
                <div {...stylex.props(styles.previewItem)}>
                  <span {...stylex.props(styles.previewLabel)}>{t('settings.connection.url')}</span>
                  <span {...stylex.props(styles.previewValue)}>{customParams.url}</span>
                </div>
              )}

              {customParams?.type === 'stdio' && (
                <>
                  {customParams?.command && (
                    <div {...stylex.props(styles.previewItem)}>
                      <span {...stylex.props(styles.previewLabel)}>
                        {t('settings.connection.command')}
                      </span>
                      <span {...stylex.props(styles.previewValue)}>{customParams.command}</span>
                    </div>
                  )}

                  {customParams?.args && customParams.args.length > 0 && (
                    <div {...stylex.props(styles.previewItem)}>
                      <span {...stylex.props(styles.previewLabel)}>
                        {t('settings.connection.args')}
                      </span>
                      <span {...stylex.props(styles.previewValue)}>
                        {customParams.args.join(' ')}
                      </span>
                    </div>
                  )}
                </>
              )}
            </Flexbox>
          ) : (
            // Edit mode
            <div {...stylex.props(styles.connectionForm)}>
              <Form form={connectionForm} layout="vertical">
                {customParams?.type === 'http' && (
                  <Form.Field
                    label={t('settings.connection.url')}
                    name={'url'}
                    required={t('settings.rules.urlRequired')}
                  >
                    <Input placeholder="https://mcp.example.com/server" size="small" />
                  </Form.Field>
                )}

                {customParams?.type === 'stdio' && (
                  <>
                    <Form.Field
                      label={t('settings.connection.command')}
                      name={'command'}
                      required={t('settings.rules.commandRequired')}
                    >
                      <MCPStdioCommandInput
                        placeholder="npx, uv, python..."
                        onParsedArgs={(args) => {
                          const existing: string[] = connectionForm.getValue('args') ?? [];
                          connectionForm.setValue('args', [...args, ...existing.filter(Boolean)]);
                        }}
                      />
                    </Form.Field>

                    <Form.Field
                      label={t('settings.connection.args')}
                      name={'args'}
                      required={t('settings.rules.argsRequired')}
                    >
                      <ArgsInput placeholder="e.g: mcp-hello-world" />
                    </Form.Field>
                  </>
                )}
                <Flexbox horizontal className={stylex.props(styles.footer).className} gap={8}>
                  <Button htmlType="submit" loading={connectionLoading} type="primary">
                    {t('common:save')}
                  </Button>
                  <Button onClick={handleCancelEdit}>{t('common:cancel')}</Button>
                </Flexbox>
              </Form>
            </div>
          )}
        </Flexbox>

        {/* Environment variable configuration (stdio type only) */}
        {isStdioType && (
          <Flexbox gap={12}>
            <div {...stylex.props(styles.sectionTitle)}>
              <Settings2Icon size={16} />
              {t('settings.configuration.title')}
            </div>
            <Text style={{ fontSize: 12 }} type="secondary">
              {t('settings.envConfigDescription')}
            </Text>
            <Form form={envForm} layout="vertical">
              <Form.Field bare name="env">
                <KeyValueEditor
                  addButtonText={t('dev.mcp.env.add')}
                  keyPlaceholder="VARIABLE_NAME"
                />
              </Form.Field>
              {!hideFooter && (
                <Flexbox horizontal className={stylex.props(styles.footer).className} gap={8}>
                  <Button htmlType="submit" loading={loading} type="primary">
                    {t('common:save')}
                  </Button>
                  <Button onClick={resetEnvForm}>{t('common:reset')}</Button>
                </Flexbox>
              )}
            </Form>
          </Flexbox>
        )}

        {/* HTTP type notice */}
        {!isStdioType && (
          <div>
            <div {...stylex.props(styles.sectionTitle)}>
              <Settings2Icon size={16} />
              {t('settings.configuration.title')}
            </div>
            <div {...stylex.props(styles.emptyState)}>
              <Text type="secondary">{t('settings.httpTypeNotice')}</Text>
            </div>
          </div>
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default Settings;

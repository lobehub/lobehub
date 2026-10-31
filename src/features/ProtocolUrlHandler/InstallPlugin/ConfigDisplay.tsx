'use client';

import { type McpInstallSchema } from '@lobechat/electron-client-ipc';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { LinkIcon, Settings2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import KeyValueEditor from '@/components/KeyValueEditor';

const styles = stylex.create({
  configEditor: { marginBlockStart: cssVar.marginSM },
  configSection: {
    marginBlockEnd: cssVar.marginLG,
    padding: cssVar.paddingSM,
    borderRadius: cssVar.borderRadius,
  },
  configTitle: {
    display: 'flex',
    gap: cssVar.marginXS,
    alignItems: 'center',
    height: '24px',
    fontWeight: 600,
    color: cssVar.colorTextHeading,
  },
  previewContainer: { paddingInline: cssVar.paddingXS },
  previewItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: cssVar.paddingXS,
    paddingInline: '0',
    borderBlockEndWidth: { 'default': '1px', ':last-child': '0' },
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
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
    borderRadius: cssVar.borderRadiusSM,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    fontWeight: 600,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  typeValue: { display: 'flex', gap: cssVar.marginXS, alignItems: 'center' },
  urlValue: {
    // eslint-disable-next-line @stylexjs/valid-styles -- Supported by the compiler/browser, missing from the 0.19 keyword list.
    wordBreak: 'auto-phrase',
    maxWidth: '300px',
    paddingBlock: cssVar.paddingXS,
    paddingInline: cssVar.paddingSM,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    fontWeight: 500,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
});

interface ConfigDisplayProps {
  onConfigUpdate?: (updatedConfig: {
    env?: Record<string, string>;
    headers?: Record<string, string>;
  }) => void;
  schema: McpInstallSchema;
}

const ConfigDisplay = memo<ConfigDisplayProps>(({ schema, onConfigUpdate }) => {
  const { t } = useTranslation('plugin');

  // Local state management for config data
  const [currentEnv, setCurrentEnv] = useState<Record<string, string>>(schema.config.env || {});
  const [currentHeaders, setCurrentHeaders] = useState<Record<string, string>>(
    schema.config.headers || {},
  );

  // Handle environment variable updates
  const handleEnvUpdate = (newEnv: Record<string, string>) => {
    setCurrentEnv(newEnv);
    onConfigUpdate?.({ env: newEnv, headers: currentHeaders });
  };

  // Handle Headers updates
  const handleHeadersUpdate = (newHeaders: Record<string, string>) => {
    setCurrentHeaders(newHeaders);
    onConfigUpdate?.({ env: currentEnv, headers: newHeaders });
  };

  return (
    <Flexbox gap={16}>
      {/* Installation info */}
      <Block className={stylex.props(styles.configSection).className} variant={'outlined'}>
        <div {...stylex.props(styles.configTitle)}>
          <LinkIcon size={14} />
          {t('protocolInstall.install.title')}
        </div>

        <div {...stylex.props(styles.previewContainer)}>
          {/* Connection type */}
          <div {...stylex.props(styles.previewItem)}>
            <span {...stylex.props(styles.previewLabel)}>
              {t('protocolInstall.config.type.label')}
            </span>
            <div {...stylex.props(styles.typeValue)}>
              <Text className={stylex.props(styles.previewValue).className}>
                {schema.config.type === 'stdio' ? 'STDIO' : 'HTTP'}
              </Text>
            </div>
          </div>

          {/* HTTP type shows URL */}
          {schema.config.type === 'http' && schema.config.url && (
            <div {...stylex.props(styles.previewItem)}>
              <span {...stylex.props(styles.previewLabel)}>{t('protocolInstall.config.url')}</span>
              <div {...stylex.props(styles.urlValue)}>{schema.config.url}</div>
            </div>
          )}

          {/* STDIO type shows command and args */}
          {schema.config.type === 'stdio' && (
            <>
              {schema.config.command && (
                <div {...stylex.props(styles.previewItem)}>
                  <span {...stylex.props(styles.previewLabel)}>
                    {t('protocolInstall.config.command')}
                  </span>
                  <span {...stylex.props(styles.previewValue)}>{schema.config.command}</span>
                </div>
              )}

              {schema.config.args && schema.config.args.length > 0 && (
                <div {...stylex.props(styles.previewItem)}>
                  <span {...stylex.props(styles.previewLabel)}>
                    {t('protocolInstall.config.args')}
                  </span>
                  <span {...stylex.props(styles.previewValue)}>{schema.config.args.join(' ')}</span>
                </div>
              )}
            </>
          )}
        </div>
      </Block>

      {/* Config info - directly use KeyValueEditor */}
      <Block className={stylex.props(styles.configSection).className} variant={'outlined'}>
        <div {...stylex.props(styles.configTitle)}>
          <Settings2Icon size={14} />
          {schema.config.type === 'stdio'
            ? t('protocolInstall.config.env')
            : t('protocolInstall.config.headers')}
        </div>

        <div {...stylex.props(styles.configEditor)}>
          {/* HTTP type shows Headers */}
          {schema.config.type === 'http' && (
            <KeyValueEditor
              addButtonText={t('protocolInstall.config.addHeaders')}
              style={{ border: 'none' }}
              value={currentHeaders}
              onChange={handleHeadersUpdate}
            />
          )}

          {/* STDIO type shows environment variables */}
          {schema.config.type === 'stdio' && (
            <KeyValueEditor
              addButtonText={t('protocolInstall.config.addEnv')}
              style={{ border: 'none' }}
              value={currentEnv}
              onChange={handleEnvUpdate}
            />
          )}
        </div>
      </Block>
    </Flexbox>
  );
});

ConfigDisplay.displayName = 'ConfigDisplay';

export default ConfigDisplay;

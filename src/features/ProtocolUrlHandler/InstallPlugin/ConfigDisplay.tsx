'use client';

import { type McpInstallSchema } from '@lobechat/electron-client-ipc';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { LinkIcon, Settings2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import KeyValueEditor from '@/components/KeyValueEditor';

const styles = createStaticStyles(({ css, cssVar }) => ({
  configEditor: css`
    margin-block-start: ${cssVar.marginSM};
  `,
  configSection: css`
    margin-block-end: ${cssVar.marginLG};
    padding: ${cssVar.paddingSM};
    border-radius: ${cssVar.borderRadius};
  `,
  configTitle: css`
    display: flex;
    gap: ${cssVar.marginXS};
    align-items: center;

    height: 24px;

    font-weight: 600;
    color: ${cssVar.colorTextHeading};
  `,

  previewContainer: css`
    padding-inline: ${cssVar.paddingXS};
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
    border-radius: ${cssVar.borderRadiusSM};

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-weight: 600;
    color: ${cssVar.colorText};

    background: ${cssVar.colorFillQuaternary};
  `,

  typeValue: css`
    display: flex;
    gap: ${cssVar.marginXS};
    align-items: center;
  `,

  urlValue: css`
    max-width: 300px;
    padding-block: ${cssVar.paddingXS};
    padding-inline: ${cssVar.paddingSM};
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    word-break: auto-phrase;

    background: ${cssVar.colorBgElevated};
  `,
}));

interface ConfigDisplayProps {
  onConfigUpdate?: (updatedConfig: {
    env?: Record<string, string>;
    headers?: Record<string, string>;
  }) => void;
  schema: McpInstallSchema;
}

const ConfigDisplay = memo<ConfigDisplayProps>(({ schema, onConfigUpdate }) => {
  const { t } = useTranslation('plugin');

  // 本地状态管理配置数据
  const [currentEnv, setCurrentEnv] = useState<Record<string, string>>(schema.config.env || {});
  const [currentHeaders, setCurrentHeaders] = useState<Record<string, string>>(
    schema.config.headers || {},
  );

  // 处理环境变量更新
  const handleEnvUpdate = (newEnv: Record<string, string>) => {
    setCurrentEnv(newEnv);
    onConfigUpdate?.({ env: newEnv, headers: currentHeaders });
  };

  // 处理 Headers 更新
  const handleHeadersUpdate = (newHeaders: Record<string, string>) => {
    setCurrentHeaders(newHeaders);
    onConfigUpdate?.({ env: currentEnv, headers: newHeaders });
  };

  return (
    <Flexbox gap={16}>
      {/* 安装信息 */}
      <Block className={styles.configSection} variant={'outlined'}>
        <div className={styles.configTitle}>
          <LinkIcon size={14} />
          {t('protocolInstall.install.title')}
        </div>

        <div className={styles.previewContainer}>
          {/* 连接类型 */}
          <div className={styles.previewItem}>
            <span className={styles.previewLabel}>{t('protocolInstall.config.type.label')}</span>
            <div className={styles.typeValue}>
              <Text className={styles.previewValue}>
                {schema.config.type === 'stdio' ? 'STDIO' : 'HTTP'}
              </Text>
            </div>
          </div>

          {/* HTTP 类型显示 URL */}
          {schema.config.type === 'http' && schema.config.url && (
            <div className={styles.previewItem}>
              <span className={styles.previewLabel}>{t('protocolInstall.config.url')}</span>
              <div className={styles.urlValue}>{schema.config.url}</div>
            </div>
          )}

          {/* STDIO 类型显示命令和参数 */}
          {schema.config.type === 'stdio' && (
            <>
              {schema.config.command && (
                <div className={styles.previewItem}>
                  <span className={styles.previewLabel}>{t('protocolInstall.config.command')}</span>
                  <span className={styles.previewValue}>{schema.config.command}</span>
                </div>
              )}

              {schema.config.args && schema.config.args.length > 0 && (
                <div className={styles.previewItem}>
                  <span className={styles.previewLabel}>{t('protocolInstall.config.args')}</span>
                  <span className={styles.previewValue}>{schema.config.args.join(' ')}</span>
                </div>
              )}
            </>
          )}
        </div>
      </Block>

      {/* 配置信息 - 直接使用 KeyValueEditor */}
      <Block className={styles.configSection} variant={'outlined'}>
        <div className={styles.configTitle}>
          <Settings2Icon size={14} />
          {schema.config.type === 'stdio'
            ? t('protocolInstall.config.env')
            : t('protocolInstall.config.headers')}
        </div>

        <div className={styles.configEditor}>
          {/* HTTP 类型显示 Headers */}
          {schema.config.type === 'http' && (
            <KeyValueEditor
              addButtonText={t('protocolInstall.config.addHeaders')}
              style={{ border: 'none' }}
              value={currentHeaders}
              onChange={handleHeadersUpdate}
            />
          )}

          {/* STDIO 类型显示环境变量 */}
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

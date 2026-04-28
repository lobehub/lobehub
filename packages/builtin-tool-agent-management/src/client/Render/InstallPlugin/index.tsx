'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { InstallPluginParams, InstallPluginState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding: 12px;
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
  label: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  statusFail: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorError};
  `,
  statusSuccess: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorSuccess};
  `,
  value: css`
    font-size: 13px;
  `,
}));

export const InstallPluginRender = memo<
  BuiltinRenderProps<InstallPluginParams, InstallPluginState>
>(({ pluginState }) => {
  const { t } = useTranslation('plugin');

  if (!pluginState) return null;

  return (
    <div className={styles.container}>
      <Flexbox gap={8}>
        <Flexbox horizontal align={'center'} gap={8}>
          <span className={styles.label}>
            {t('builtins.lobe-agent-management.render.installPlugin.plugin')}
          </span>
          <Tag>{pluginState.pluginName || pluginState.pluginId}</Tag>
        </Flexbox>
        <span className={pluginState.installed ? styles.statusSuccess : styles.statusFail}>
          {pluginState.installed
            ? t('builtins.lobe-agent-management.render.installPlugin.success')
            : t('builtins.lobe-agent-management.render.installPlugin.failed')}
        </span>
      </Flexbox>
    </div>
  );
});

InstallPluginRender.displayName = 'InstallPluginRender';

export default InstallPluginRender;

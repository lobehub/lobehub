'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { InstallPluginParams, InstallPluginState } from '../../../types';

const styles = stylex.create({
  container: { padding: '12px', borderRadius: '8px', background: cssVar.colorFillQuaternary },
  label: { fontSize: '12px', fontWeight: 500, color: cssVar.colorTextSecondary },
  statusFail: { fontSize: '13px', fontWeight: 500, color: cssVar.colorError },
  statusSuccess: { fontSize: '13px', fontWeight: 500, color: cssVar.colorSuccess },
});

export const InstallPluginRender = memo<
  BuiltinRenderProps<InstallPluginParams, InstallPluginState>
>(({ pluginState }) => {
  const { t } = useTranslation('plugin');

  if (!pluginState) return null;

  return (
    <div {...stylex.props(styles.container)}>
      <Flexbox gap={8}>
        <Flexbox horizontal align={'center'} gap={8}>
          <span {...stylex.props(styles.label)}>
            {t('builtins.lobe-agent-management.render.installPlugin.plugin')}
          </span>
          <Tag>{pluginState.pluginName || pluginState.pluginId}</Tag>
        </Flexbox>
        <span {...stylex.props(pluginState.installed ? styles.statusSuccess : styles.statusFail)}>
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

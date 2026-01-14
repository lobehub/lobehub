'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { UpdateAgentConfigParams, UpdateConfigState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  statusIcon: css`
    margin-block-end: -2px;
    margin-inline-start: 4px;
  `,
}));

export const UpdateConfigInspector = memo<
  BuiltinInspectorProps<UpdateAgentConfigParams, UpdateConfigState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const togglePlugin = args?.togglePlugin || partialArgs?.togglePlugin;
  const config = args?.config || partialArgs?.config;
  const meta = args?.meta || partialArgs?.meta;

  // Build display text
  const displayText = useMemo(() => {
    // If toggling plugin, show that info
    if (togglePlugin?.pluginId) {
      const enabled = togglePlugin.enabled ?? pluginState?.togglePlugin?.enabled;
      const action =
        enabled === true
          ? t('builtins.lobe-agent-builder.inspector.enablePlugin')
          : enabled === false
            ? t('builtins.lobe-agent-builder.inspector.disablePlugin')
            : t('builtins.lobe-agent-builder.inspector.togglePlugin');
      return `${action} ${togglePlugin.pluginId}`;
    }

    // Otherwise show updated fields
    const fields: string[] = [];
    if (config) {
      if (config.model) fields.push('model');
      if (config.provider) fields.push('provider');
      if (config.plugins) fields.push('plugins');
      if (config.params) fields.push('params');
      if (config.chatConfig) fields.push('chatConfig');
    }
    if (meta) {
      if (meta.title) fields.push('title');
      if (meta.description) fields.push('description');
      if (meta.avatar) fields.push('avatar');
    }

    return fields.length > 0 ? fields.join(', ') : '';
  }, [togglePlugin, config, meta, pluginState, t]);

  // Initial streaming state
  if (isArgumentsStreaming && !displayText) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent-builder.apiName.updateConfig')}</span>
      </div>
    );
  }

  const isSuccess = pluginState?.success;

  return (
    <div
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-agent-builder.apiName.updateConfig')}</span>
      {displayText && (
        <>
          : <span className={highlightTextStyles.primary}>{displayText}</span>
        </>
      )}
      {!isLoading && isSuccess && (
        <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
      )}
    </div>
  );
});

UpdateConfigInspector.displayName = 'UpdateConfigInspector';

export default UpdateConfigInspector;

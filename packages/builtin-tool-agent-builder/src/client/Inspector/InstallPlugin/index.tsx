'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { InstallPluginParams, InstallPluginState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  statusIcon: css`
    margin-block-end: -2px;
    margin-inline-start: 4px;
  `,
}));

export const InstallPluginInspector = memo<
  BuiltinInspectorProps<InstallPluginParams, InstallPluginState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const identifier = args?.identifier || partialArgs?.identifier;
  const displayName = pluginState?.pluginName || identifier;

  // Initial streaming state
  if (isArgumentsStreaming && !identifier) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent-builder.apiName.installPlugin')}</span>
      </div>
    );
  }

  // Get installation result
  const isSuccess = pluginState?.success && pluginState?.installed;
  const hasResult = pluginState?.success !== undefined;

  return (
    <div
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-agent-builder.apiName.installPlugin')}: </span>
      {displayName && <span className={highlightTextStyles.primary}>{displayName}</span>}
      {!isLoading &&
        hasResult &&
        (isSuccess ? (
          <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
        ) : (
          <X className={styles.statusIcon} color={cssVar.colorError} size={14} />
        ))}
    </div>
  );
});

InstallPluginInspector.displayName = 'InstallPluginInspector';

export default InstallPluginInspector;

'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { RemoveAgentParams, RemoveAgentState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  statusIcon: css`
    margin-block-end: -2px;
    margin-inline-start: 4px;
  `,
}));

export const RemoveAgentInspector = memo<
  BuiltinInspectorProps<RemoveAgentParams, RemoveAgentState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const agentId = args?.agentId || partialArgs?.agentId;
  const displayName = pluginState?.agentName || agentId;

  // Initial streaming state
  if (isArgumentsStreaming && !agentId) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-group-agent-builder.apiName.removeAgent')}</span>
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
      <span>{t('builtins.lobe-group-agent-builder.apiName.removeAgent')}: </span>
      {displayName && <span className={highlightTextStyles.primary}>{displayName}</span>}
      {!isLoading && isSuccess && (
        <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
      )}
    </div>
  );
});

RemoveAgentInspector.displayName = 'RemoveAgentInspector';

export default RemoveAgentInspector;

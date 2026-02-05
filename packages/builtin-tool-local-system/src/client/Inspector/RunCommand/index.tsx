'use client';

import type { RunCommandParams, RunCommandResult } from '@lobechat/electron-client-ipc';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

const styles = createStaticStyles(({ css }) => ({
  statusIcon: css`
    margin-block-end: -2px;
    margin-inline-start: 4px;
  `,
}));

interface RunCommandState {
  message: string;
  result: RunCommandResult;
}

export const RunCommandInspector = memo<BuiltinInspectorProps<RunCommandParams, RunCommandState>>(
  ({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
    const { t } = useTranslation('plugin');

    // Show description if available, otherwise show command
    const description = args?.description || partialArgs?.description || args?.command || '';

    // During argument streaming
    if (isArgumentsStreaming) {
      if (!description)
        return (
          <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
            <span>{t('builtins.lobe-local-system.apiName.runCommand')}</span>
          </div>
        );

      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-local-system.apiName.runCommand')}: </span>
          <span className={highlightTextStyles.primary}>{description}</span>
        </div>
      );
    }

    // Get execution result from pluginState
    const result = pluginState?.result;
    const isSuccess = result?.success || result?.exit_code === 0;

    return (
      <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
        <span style={{ marginInlineStart: 2 }}>
          <span>{t('builtins.lobe-local-system.apiName.runCommand')}: </span>
          {description && <span className={highlightTextStyles.primary}>{description}</span>}
          {isLoading ? null : result?.success !== undefined ? (
            isSuccess ? (
              <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
            ) : (
              <X className={styles.statusIcon} color={cssVar.colorError} size={14} />
            )
          ) : null}
        </span>
      </div>
    );
  },
);

RunCommandInspector.displayName = 'RunCommandInspector';

export default RunCommandInspector;

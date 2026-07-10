'use client';

import { type BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, LoaderCircle, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ExecScriptParams, ExecScriptState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  statusIcon: css`
    margin-block-end: -2px;
    margin-inline-start: 4px;
  `,
}));

export const ExecScriptInspector = memo<BuiltinInspectorProps<ExecScriptParams, ExecScriptState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    // Show description if available, otherwise show command
    const description = args?.description || partialArgs?.description || args?.command || '';

    if (isArgumentsStreaming) {
      if (!description)
        return (
          <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
            <span>{t('builtins.lobe-skills.apiName.execScript')}</span>
          </div>
        );

      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-skills.apiName.execScript')}: </span>
          <span className={highlightTextStyles.primary}>{description}</span>
        </div>
      );
    }

    const isSuccess = pluginState?.success;
    // A command that outlived the shell's observation window has no exitCode
    // yet and reports `success: true` for the model loop (still running ≠
    // failed) — but the UI must not show a completed checkmark while the
    // command is in fact still executing (pollable via shellId).
    const isStillRunning = pluginState?.exitCode === undefined && !!pluginState?.shellId;

    return (
      <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
        <span style={{ marginInlineStart: 2 }}>
          <span>{t('builtins.lobe-skills.apiName.execScript')}: </span>
          {description && <span className={highlightTextStyles.primary}>{description}</span>}
          {isLoading ? null : isStillRunning ? (
            <Icon spin className={styles.statusIcon} icon={LoaderCircle} size={14} />
          ) : pluginState?.success !== undefined ? (
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

ExecScriptInspector.displayName = 'ExecScriptInspector';

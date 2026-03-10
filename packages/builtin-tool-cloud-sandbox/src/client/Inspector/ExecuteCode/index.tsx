'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ExecuteCodeState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  statusIcon: css`
    margin-block-end: -2px;
    margin-inline-start: 4px;
  `,
}));

interface ExecuteCodeParams {
  code: string;
  description: string;
  language?: 'javascript' | 'python' | 'typescript';
}

export const ExecuteCodeInspector = memo<
  BuiltinInspectorProps<ExecuteCodeParams, ExecuteCodeState>
>(({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
  const { t } = useTranslation('plugin');

  const description = args?.description || partialArgs?.description;

  if (isArgumentsStreaming) {
    if (!description)
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-cloud-sandbox.apiName.executeCode')}</span>
        </div>
      );

    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-cloud-sandbox.apiName.executeCode')}: </span>
        <span className={highlightTextStyles.gold}>{description}</span>
      </div>
    );
  }

  return (
    <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
      <span style={{ marginInlineStart: 2 }}>
        <span>{t('builtins.lobe-cloud-sandbox.apiName.executeCode')}: </span>
        {description && <span className={highlightTextStyles.primary}>{description}</span>}
        {isLoading ? null : pluginState?.success ? (
          <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
        ) : (
          <X className={styles.statusIcon} color={cssVar.colorError} size={14} />
        )}
      </span>
    </div>
  );
});

ExecuteCodeInspector.displayName = 'ExecuteCodeInspector';

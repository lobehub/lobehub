'use client';

import { type BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, shinyTextStyles } from '@/styles';

import { type ExecuteCodeState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextSecondary};
  `,
}));

interface ExecuteCodeParams {
  code: string;
  description: string;
  language?: 'javascript' | 'python' | 'typescript';
}

export const ExecuteCodeInspector = memo<
  BuiltinInspectorProps<ExecuteCodeParams, ExecuteCodeState>
>(({ args, partialArgs, isArgumentsStreaming }) => {
  const { t } = useTranslation('plugin');

  const description = args?.description || partialArgs?.description;

  if (isArgumentsStreaming && !description) {
    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-cloud-sandbox.apiName.executeCode')}</span>
      </div>
    );
  }

  return (
    <div className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}>
      <span>{t('builtins.lobe-cloud-sandbox.apiName.executeCode')}: </span>
      {description && <span className={highlightTextStyles.gold}>{description}</span>}
    </div>
  );
});

ExecuteCodeInspector.displayName = 'ExecuteCodeInspector';

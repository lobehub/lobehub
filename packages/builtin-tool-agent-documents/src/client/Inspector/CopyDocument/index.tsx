'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CopyDocumentArgs, CopyDocumentState } from '../../../types';

export const CopyDocumentInspector = memo<
  BuiltinInspectorProps<CopyDocumentArgs, CopyDocumentState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');
  const summary = args?.newTitle || partialArgs?.newTitle || args?.id || partialArgs?.id;

  if (isArgumentsStreaming && !summary) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent-documents.apiName.copyDocument')}</span>
      </div>
    );
  }

  return (
    <div
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-agent-documents.apiName.copyDocument')}: </span>
      {summary && <span className={highlightTextStyles.primary}>{summary}</span>}
    </div>
  );
});

CopyDocumentInspector.displayName = 'CopyDocumentInspector';

export default CopyDocumentInspector;

'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { PatchDocumentArgs, PatchDocumentState } from '../../../types';

export const PatchDocumentInspector = memo<
  BuiltinInspectorProps<PatchDocumentArgs, PatchDocumentState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');
  const id = args?.id || partialArgs?.id;

  if (isArgumentsStreaming && !id) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent-documents.apiName.patchDocument')}</span>
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
      <span>{t('builtins.lobe-agent-documents.apiName.patchDocument')}: </span>
      {id && <span className={highlightTextStyles.primary}>{id}</span>}
    </div>
  );
});

PatchDocumentInspector.displayName = 'PatchDocumentInspector';

export default PatchDocumentInspector;

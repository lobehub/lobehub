'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { RenameDocumentArgs, RenameDocumentState } from '../../../types';

export const RenameDocumentInspector = memo<
  BuiltinInspectorProps<RenameDocumentArgs, RenameDocumentState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');
  const newTitle = args?.newTitle || partialArgs?.newTitle;

  if (isArgumentsStreaming && !newTitle) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent-documents.apiName.renameDocument')}</span>
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
      <span>{t('builtins.lobe-agent-documents.apiName.renameDocument')}: </span>
      {newTitle && <span className={highlightTextStyles.primary}>{newTitle}</span>}
    </div>
  );
});

RenameDocumentInspector.displayName = 'RenameDocumentInspector';

export default RenameDocumentInspector;

'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { UpsertDocumentByFilenameArgs, UpsertDocumentByFilenameState } from '../../../types';

export const UpsertDocumentByFilenameInspector = memo<
  BuiltinInspectorProps<UpsertDocumentByFilenameArgs, UpsertDocumentByFilenameState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');
  const filename = args?.filename || partialArgs?.filename;

  if (isArgumentsStreaming && !filename) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent-documents.apiName.upsertDocumentByFilename')}</span>
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
      <span>{t('builtins.lobe-agent-documents.apiName.upsertDocumentByFilename')}: </span>
      {filename && <span className={highlightTextStyles.primary}>{filename}</span>}
    </div>
  );
});

UpsertDocumentByFilenameInspector.displayName = 'UpsertDocumentByFilenameInspector';

export default UpsertDocumentByFilenameInspector;

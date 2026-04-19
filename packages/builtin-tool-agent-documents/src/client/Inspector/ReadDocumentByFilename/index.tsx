'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ReadDocumentByFilenameArgs, ReadDocumentByFilenameState } from '../../../types';

export const ReadDocumentByFilenameInspector = memo<
  BuiltinInspectorProps<ReadDocumentByFilenameArgs, ReadDocumentByFilenameState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');
  const filename = args?.filename || partialArgs?.filename;

  if (isArgumentsStreaming && !filename) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent-documents.apiName.readDocumentByFilename')}</span>
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
      <span>{t('builtins.lobe-agent-documents.apiName.readDocumentByFilename')}: </span>
      {filename && <span className={highlightTextStyles.primary}>{filename}</span>}
    </div>
  );
});

ReadDocumentByFilenameInspector.displayName = 'ReadDocumentByFilenameInspector';

export default ReadDocumentByFilenameInspector;

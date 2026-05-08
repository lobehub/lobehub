'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ReadDocumentArgs, ReadDocumentState } from '../../../types';
import { formatDocumentId, inspectorChipStyles } from '../_styles';

export const ReadDocumentInspector = memo<
  BuiltinInspectorProps<ReadDocumentArgs, ReadDocumentState>
>(({ args, partialArgs, pluginState, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const id = args?.id || partialArgs?.id;
  const title = pluginState?.title;
  const styles = inspectorChipStyles;

  if (isArgumentsStreaming && !title && !id) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent-documents.apiName.readDocument')}</span>
      </div>
    );
  }

  return (
    <div
      style={{ flexWrap: 'wrap', gap: 4 }}
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-agent-documents.apiName.readDocument')}</span>
      {title ? (
        <span className={styles.chip}>{title}</span>
      ) : (
        id && <span className={styles.idChip}>{formatDocumentId(id)}</span>
      )}
    </div>
  );
});

ReadDocumentInspector.displayName = 'ReadDocumentInspector';

export default ReadDocumentInspector;

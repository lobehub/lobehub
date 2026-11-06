'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
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

  if (isArgumentsStreaming && !title && !id) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-agent-documents.apiName.readDocument')}
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-agent-documents.apiName.readDocument')}
      </span>
      {title ? (
        <span {...stylex.props(inspectorChipStyles.chip)}>{title}</span>
      ) : (
        id && <span {...stylex.props(inspectorChipStyles.idChip)}>{formatDocumentId(id)}</span>
      )}
    </div>
  );
});

ReadDocumentInspector.displayName = 'ReadDocumentInspector';

export default ReadDocumentInspector;

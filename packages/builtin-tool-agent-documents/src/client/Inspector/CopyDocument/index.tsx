'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CopyDocumentArgs, CopyDocumentState } from '../../../types';
import { formatDocumentId, inspectorChipStyles } from '../_styles';

export const CopyDocumentInspector = memo<
  BuiltinInspectorProps<CopyDocumentArgs, CopyDocumentState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const id = args?.id || partialArgs?.id;
  const newTitle = args?.newTitle || partialArgs?.newTitle;

  if (isArgumentsStreaming && !id && !newTitle) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-agent-documents.apiName.copyDocument')}
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-agent-documents.apiName.copyDocument')}
      </span>
      {id && <span {...stylex.props(inspectorChipStyles.idChip)}>{formatDocumentId(id)}</span>}
      {newTitle && (
        <>
          <span {...stylex.props(inspectorChipStyles.separator)}>→</span>
          <span {...stylex.props(inspectorChipStyles.chip)}>{newTitle}</span>
        </>
      )}
    </div>
  );
});

CopyDocumentInspector.displayName = 'CopyDocumentInspector';

export default CopyDocumentInspector;

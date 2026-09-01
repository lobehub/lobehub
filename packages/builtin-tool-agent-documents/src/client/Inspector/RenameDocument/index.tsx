'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { RenameDocumentArgs, RenameDocumentState } from '../../../types';
import { formatDocumentId, inspectorChipStyles } from '../_styles';

export const RenameDocumentInspector = memo<
  BuiltinInspectorProps<RenameDocumentArgs, RenameDocumentState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const id = args?.id || partialArgs?.id;
  const newTitle = args?.newTitle || partialArgs?.newTitle;
  const styles = inspectorChipStyles;

  if (isArgumentsStreaming && !id && !newTitle) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-agent-documents.apiName.renameDocument')}
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-agent-documents.apiName.renameDocument')}
      </span>
      {id && <span className={styles.idChip}>{formatDocumentId(id)}</span>}
      {newTitle && (
        <>
          <span className={styles.separator}>→</span>
          <span className={styles.chip}>{newTitle}</span>
        </>
      )}
    </div>
  );
});

RenameDocumentInspector.displayName = 'RenameDocumentInspector';

export default RenameDocumentInspector;

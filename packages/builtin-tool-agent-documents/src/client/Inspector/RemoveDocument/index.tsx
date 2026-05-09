'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { RemoveDocumentArgs, RemoveDocumentState } from '../../../types';
import { formatDocumentId } from '../_styles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  removeChip: css`
    flex-shrink: 0;

    padding-block: 2px;
    padding-inline: 8px;
    border: 1px dashed ${cssVar.colorErrorBorder};
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorError};
    text-decoration: line-through;

    background: transparent;
  `,
}));

export const RemoveDocumentInspector = memo<
  BuiltinInspectorProps<RemoveDocumentArgs, RemoveDocumentState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const id = args?.id || partialArgs?.id;

  return (
    <div
      style={{ flexWrap: 'wrap', gap: 4 }}
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span style={{ color: cssVar.colorError }}>
        {t('builtins.lobe-agent-documents.apiName.removeDocument')}
      </span>
      {id && <span className={styles.removeChip}>{formatDocumentId(id)}</span>}
    </div>
  );
});

RemoveDocumentInspector.displayName = 'RemoveDocumentInspector';

export default RemoveDocumentInspector;

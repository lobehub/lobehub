'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ReplaceDocumentContentArgs, ReplaceDocumentContentState } from '../../../types';
import { formatDocumentId, inspectorChipStyles } from '../_styles';

export const ReplaceDocumentContentInspector = memo<
  BuiltinInspectorProps<ReplaceDocumentContentArgs, ReplaceDocumentContentState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const id = args?.id || partialArgs?.id;
  const content = args?.content || partialArgs?.content;
  const styles = inspectorChipStyles;

  if (isArgumentsStreaming && !id) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent-documents.apiName.replaceDocumentContent')}</span>
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
      <span>{t('builtins.lobe-agent-documents.apiName.replaceDocumentContent')}</span>
      {id && <span className={styles.idChip}>{formatDocumentId(id)}</span>}
      {typeof content === 'string' && content.length > 0 && (
        <>
          <span className={styles.separator}>·</span>
          <span className={styles.subdued}>
            {t('builtins.lobe-agent-documents.inspector.chars', { count: content.length })}
          </span>
        </>
      )}
    </div>
  );
});

ReplaceDocumentContentInspector.displayName = 'ReplaceDocumentContentInspector';

export default ReplaceDocumentContentInspector;

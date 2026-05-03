'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ListDocumentsArgs, ListDocumentsState } from '../../../types';
import { inspectorChipStyles } from '../_styles';

export const ListDocumentsInspector = memo<
  BuiltinInspectorProps<ListDocumentsArgs, ListDocumentsState>
>(({ args, partialArgs, pluginState, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const target = args?.target || partialArgs?.target;
  const count = pluginState?.documents?.length;
  const styles = inspectorChipStyles;

  return (
    <div
      style={{ flexWrap: 'wrap', gap: 4 }}
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-agent-documents.apiName.listDocuments')}</span>
      {target && (
        <>
          <span className={styles.separator}>·</span>
          <span className={styles.subdued}>
            {t(`builtins.lobe-agent-documents.inspector.target.${target}` as const)}
          </span>
        </>
      )}
      {typeof count === 'number' && (
        <>
          <span className={styles.separator}>·</span>
          <span className={styles.subdued}>
            {t('builtins.lobe-agent-documents.inspector.docCount', { count })}
          </span>
        </>
      )}
    </div>
  );
});

ListDocumentsInspector.displayName = 'ListDocumentsInspector';

export default ListDocumentsInspector;

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

  const scope = args?.scope || partialArgs?.scope;
  const count = pluginState?.documents?.length;
  const styles = inspectorChipStyles;

  return (
    <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-agent-documents.apiName.listDocuments')}
      </span>
      {scope && (
        <>
          <span className={styles.separator}>·</span>
          <span className={styles.subdued}>
            {t(`builtins.lobe-agent-documents.inspector.scope.${scope}` as const)}
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

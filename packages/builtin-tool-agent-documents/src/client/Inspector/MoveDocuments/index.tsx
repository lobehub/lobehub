'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { MoveDocumentsArgs, MoveDocumentsState } from '../../../types';
import { inspectorChipStyles } from '../_styles';

export const MoveDocumentsInspector = memo<
  BuiltinInspectorProps<MoveDocumentsArgs, MoveDocumentsState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const ids = args?.ids || partialArgs?.ids;
  const styles = inspectorChipStyles;
  const count = pluginState?.movedCount ?? ids?.length;

  return (
    <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-agent-documents.apiName.moveDocuments')}
      </span>
      {count !== undefined && (
        <span className={styles.chip}>
          {t('builtins.lobe-agent-documents.inspector.docCount', { count })}
        </span>
      )}
      {!!pluginState?.failedCount && (
        <span className={styles.subdued}>
          {t('builtins.lobe-agent-documents.inspector.failedCount', {
            count: pluginState.failedCount,
          })}
        </span>
      )}
    </div>
  );
});

MoveDocumentsInspector.displayName = 'MoveDocumentsInspector';

export default MoveDocumentsInspector;

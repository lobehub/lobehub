'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ModifyDocumentNodesArgs, ModifyDocumentNodesState } from '../../../types';
import { formatDocumentId, inspectorChipStyles } from '../_styles';

export const ModifyNodesInspector = memo<
  BuiltinInspectorProps<ModifyDocumentNodesArgs, ModifyDocumentNodesState>
>(({ args, partialArgs, pluginState, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const id = args?.id || partialArgs?.id;
  const operations = args?.operations || partialArgs?.operations;
  const opCount = operations?.length ?? 0;
  const successCount = pluginState?.successCount;
  const totalCount = pluginState?.totalCount;
  const styles = inspectorChipStyles;

  if (isArgumentsStreaming && !id) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent-documents.apiName.modifyNodes')}</span>
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
      <span>{t('builtins.lobe-agent-documents.apiName.modifyNodes')}</span>
      {id && <span className={styles.idChip}>{formatDocumentId(id)}</span>}
      {(typeof totalCount === 'number' || opCount > 0) && (
        <>
          <span className={styles.separator}>·</span>
          <span className={styles.subdued}>
            {typeof successCount === 'number' && typeof totalCount === 'number'
              ? t('builtins.lobe-agent-documents.inspector.opsResult', {
                  success: successCount,
                  total: totalCount,
                })
              : t('builtins.lobe-agent-documents.inspector.opsCount', { count: opCount })}
          </span>
        </>
      )}
    </div>
  );
});

ModifyNodesInspector.displayName = 'ModifyNodesInspector';

export default ModifyNodesInspector;

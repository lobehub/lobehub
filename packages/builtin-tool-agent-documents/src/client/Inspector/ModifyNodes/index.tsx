'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
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

  if (isArgumentsStreaming && !id) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-agent-documents.apiName.modifyNodes')}
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-agent-documents.apiName.modifyNodes')}
      </span>
      {id && <span {...stylex.props(inspectorChipStyles.idChip)}>{formatDocumentId(id)}</span>}
      {(typeof totalCount === 'number' || opCount > 0) && (
        <>
          <span {...stylex.props(inspectorChipStyles.separator)}>·</span>
          <span {...stylex.props(inspectorChipStyles.subdued)}>
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

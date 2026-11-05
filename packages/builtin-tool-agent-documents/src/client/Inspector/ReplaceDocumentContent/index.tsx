'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
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

  if (isArgumentsStreaming && !id) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-agent-documents.apiName.replaceDocumentContent')}
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-agent-documents.apiName.replaceDocumentContent')}
      </span>
      {id && <span {...stylex.props(inspectorChipStyles.idChip)}>{formatDocumentId(id)}</span>}
      {typeof content === 'string' && content.length > 0 && (
        <>
          <span {...stylex.props(inspectorChipStyles.separator)}>·</span>
          <span {...stylex.props(inspectorChipStyles.subdued)}>
            {t('builtins.lobe-agent-documents.inspector.chars', { count: content.length })}
          </span>
        </>
      )}
    </div>
  );
});

ReplaceDocumentContentInspector.displayName = 'ReplaceDocumentContentInspector';

export default ReplaceDocumentContentInspector;

'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { RemoveDocumentArgs, RemoveDocumentState } from '../../../types';
import { formatDocumentId } from '../_styles';

const styles = stylex.create({
  removeChip: {
    flexShrink: 0,
    paddingBlock: '2px',
    paddingInline: '8px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorErrorBorder,
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorError,
    textDecoration: 'line-through',
    background: 'transparent',
  },
});

export const RemoveDocumentInspector = memo<
  BuiltinInspectorProps<RemoveDocumentArgs, RemoveDocumentState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const id = args?.id || partialArgs?.id;

  return (
    <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
      <span
        className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}
        style={{ color: cssVar.colorError }}
      >
        {t('builtins.lobe-agent-documents.apiName.removeDocument')}
      </span>
      {id && <span {...stylex.props(styles.removeChip)}>{formatDocumentId(id)}</span>}
    </div>
  );
});

RemoveDocumentInspector.displayName = 'RemoveDocumentInspector';

export default RemoveDocumentInspector;

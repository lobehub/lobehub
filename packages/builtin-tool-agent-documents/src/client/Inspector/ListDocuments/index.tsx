'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ListDocumentsArgs, ListDocumentsState } from '../../../types';

export const ListDocumentsInspector = memo<
  BuiltinInspectorProps<ListDocumentsArgs, ListDocumentsState>
>(({ isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  return (
    <div
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-agent-documents.apiName.listDocuments')}</span>
    </div>
  );
});

ListDocumentsInspector.displayName = 'ListDocumentsInspector';

export default ListDocumentsInspector;

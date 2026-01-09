'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, shinyTextStyles } from '@/styles';

import type { CreateDocumentArgs, CreateDocumentState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextSecondary};
  `,
}));

export const CreateDocumentInspector = memo<
  BuiltinInspectorProps<CreateDocumentArgs, CreateDocumentState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const title = args?.title || partialArgs?.title;

  // During streaming without title, show init
  if (isArgumentsStreaming && !title) {
    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-notebook.apiName.createDocument')}</span>
      </div>
    );
  }

  return (
    <div
      className={cx(styles.root, (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}
    >
      <span>{t('builtins.lobe-notebook.apiName.createDocument')}: </span>
      {title && <span className={highlightTextStyles.primary}>{title}</span>}
    </div>
  );
});

CreateDocumentInspector.displayName = 'CreateDocumentInspector';

export default CreateDocumentInspector;

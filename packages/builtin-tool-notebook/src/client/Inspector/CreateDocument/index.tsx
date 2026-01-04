'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { CreateDocumentArgs, CreateDocumentState } from '../../../types';
import { AnimatedNumber } from '../../components/AnimatedNumber';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
  `,
  title: css`
    margin-inline-end: 8px;
    color: ${cssVar.colorText};
  `,
}));

export const CreateDocumentInspector = memo<
  BuiltinInspectorProps<CreateDocumentArgs, CreateDocumentState>
>(({ args, partialArgs, isArgumentsStreaming }) => {
  const { t } = useTranslation('plugin');

  // Calculate chars from content
  const content = args?.content || partialArgs?.content || '';
  const chars = content.length;

  const hasContent = chars > 0;

  // During streaming without content, show init
  if (isArgumentsStreaming) {
    if (!hasContent)
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-notebook.apiName.createDocument')}</span>
        </div>
      );

    // During streaming with content, show "creating" title with shiny effect
    return (
      <div className={styles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-notebook.apiName.createDocument.creating')}
        </span>
        {chars > 0 && (
          <Text as={'span'} code color={cssVar.colorTextDescription} fontSize={12}>
            {' '}
            <AnimatedNumber value={chars} />
            {t('builtins.lobe-notebook.apiName.createDocument.chars')}
          </Text>
        )}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <span className={styles.title}>
        {t('builtins.lobe-notebook.apiName.createDocument.result')}
      </span>
      {chars > 0 && (
        <Text as={'span'} code color={cssVar.colorTextDescription} fontSize={12}>
          <AnimatedNumber value={chars} />
          {t('builtins.lobe-notebook.apiName.createDocument.chars')}
        </Text>
      )}
    </div>
  );
});

CreateDocumentInspector.displayName = 'CreateDocumentInspector';

export default CreateDocumentInspector;

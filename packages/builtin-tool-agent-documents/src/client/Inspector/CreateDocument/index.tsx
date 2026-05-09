'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CreateDocumentArgs, CreateDocumentState } from '../../../types';
import { inspectorChipStyles } from '../_styles';

export const CreateDocumentInspector = memo<
  BuiltinInspectorProps<CreateDocumentArgs, CreateDocumentState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const title = args?.title || partialArgs?.title;
  const target = args?.target || partialArgs?.target;
  const styles = inspectorChipStyles;

  if (isArgumentsStreaming && !title) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent-documents.apiName.createDocument')}</span>
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
      <span>{t('builtins.lobe-agent-documents.apiName.createDocument')}</span>
      {title && <span className={styles.chip}>{title}</span>}
      {target && (
        <>
          <span className={styles.separator}>·</span>
          <span className={styles.subdued}>
            {t(`builtins.lobe-agent-documents.inspector.target.${target}` as const)}
          </span>
        </>
      )}
    </div>
  );
});

CreateDocumentInspector.displayName = 'CreateDocumentInspector';

export default CreateDocumentInspector;

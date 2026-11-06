'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
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
  const scope = args?.scope || partialArgs?.scope;

  if (isArgumentsStreaming && !title) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-agent-documents.apiName.createDocument')}
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-agent-documents.apiName.createDocument')}
      </span>
      {title && <span {...stylex.props(inspectorChipStyles.chip)}>{title}</span>}
      {scope && (
        <>
          <span {...stylex.props(inspectorChipStyles.separator)}>·</span>
          <span {...stylex.props(inspectorChipStyles.subdued)}>
            {t(`builtins.lobe-agent-documents.inspector.scope.${scope}` as const)}
          </span>
        </>
      )}
    </div>
  );
});

CreateDocumentInspector.displayName = 'CreateDocumentInspector';

export default CreateDocumentInspector;

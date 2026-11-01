'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CreateFolderArgs, CreateFolderState } from '../../../types';
import { inspectorChipStyles } from '../_styles';

export const CreateFolderInspector = memo<
  BuiltinInspectorProps<CreateFolderArgs, CreateFolderState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const title = args?.title || partialArgs?.title;
  const styles = inspectorChipStyles;

  if (isArgumentsStreaming && !title) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-agent-documents.apiName.createFolder')}
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-agent-documents.apiName.createFolder')}
      </span>
      {title && <span className={styles.chip}>{title}</span>}
    </div>
  );
});

CreateFolderInspector.displayName = 'CreateFolderInspector';

export default CreateFolderInspector;

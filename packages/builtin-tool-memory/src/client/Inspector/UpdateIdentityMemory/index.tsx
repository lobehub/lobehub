'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { UpdateIdentityMemoryParams, UpdateIdentityMemoryState } from '../../../types';

export const UpdateIdentityMemoryInspector = memo<
  BuiltinInspectorProps<UpdateIdentityMemoryParams, UpdateIdentityMemoryState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const id = args?.id || partialArgs?.id;

  // Initial streaming state
  if (isArgumentsStreaming && !id) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-user-memory.apiName.updateIdentityMemory')}
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-user-memory.apiName.updateIdentityMemory')}
      </span>
    </div>
  );
});

UpdateIdentityMemoryInspector.displayName = 'UpdateIdentityMemoryInspector';

export default UpdateIdentityMemoryInspector;

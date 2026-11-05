'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { UpdateDocumentArgs } from '../../../types';
import { inspectorChipStyles } from '../_styles';

export const UpdateDocumentInspector = memo<
  BuiltinInspectorProps<UpdateDocumentArgs, { applied?: number }>
>(({ args, partialArgs, pluginState, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const type = args?.type ?? partialArgs?.type;
  const requestedHunks = args?.hunks?.length ?? partialArgs?.hunks?.length ?? 0;
  const applied = pluginState?.applied;
  const hunkCount = typeof applied === 'number' ? applied : requestedHunks;

  if (isArgumentsStreaming && !type) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-web-onboarding.apiName.updateDocument')}
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root} style={{ gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-web-onboarding.apiName.updateDocument')}
      </span>
      {type && (
        <span {...stylex.props(inspectorChipStyles.chip)}>
          {t(`builtins.lobe-web-onboarding.docType.${type}` as const)}
        </span>
      )}
      {hunkCount > 0 && (
        <span {...stylex.props(inspectorChipStyles.meta)}>
          {t('builtins.lobe-web-onboarding.inspector.hunkCount', { count: hunkCount })}
        </span>
      )}
    </div>
  );
});

UpdateDocumentInspector.displayName = 'UpdateDocumentInspector';

export default UpdateDocumentInspector;

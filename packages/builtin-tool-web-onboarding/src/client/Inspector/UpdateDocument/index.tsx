'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { UpdateDocumentArgs } from '../../../types';
import { inspectorChipStyles } from '../_styles';

export const UpdateDocumentInspector = memo<
  BuiltinInspectorProps<UpdateDocumentArgs, { applied?: number }>
>(({ args, partialArgs, pluginState, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');
  const styles = inspectorChipStyles;

  const type = args?.type ?? partialArgs?.type;
  const requestedHunks = args?.hunks?.length ?? partialArgs?.hunks?.length ?? 0;
  const applied = pluginState?.applied;
  const hunkCount = typeof applied === 'number' ? applied : requestedHunks;

  if (isArgumentsStreaming && !type) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-web-onboarding.apiName.updateDocument')}</span>
      </div>
    );
  }

  return (
    <div
      style={{ gap: 4 }}
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-web-onboarding.apiName.updateDocument')}</span>
      {type && (
        <span className={styles.chip}>
          {t(`builtins.lobe-web-onboarding.docType.${type}` as const)}
        </span>
      )}
      {hunkCount > 0 && (
        <span className={styles.meta}>
          {t('builtins.lobe-web-onboarding.inspector.hunkCount', { count: hunkCount })}
        </span>
      )}
    </div>
  );
});

UpdateDocumentInspector.displayName = 'UpdateDocumentInspector';

export default UpdateDocumentInspector;

'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { AddContextMemoryParams, AddContextMemoryState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  statusIcon: css`
    margin-block-end: -2px;
    margin-inline-start: 4px;
  `,
}));

export const AddContextMemoryInspector = memo<
  BuiltinInspectorProps<AddContextMemoryParams, AddContextMemoryState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const title = args?.title || partialArgs?.title;

  // Initial streaming state
  if (isArgumentsStreaming && !title) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-user-memory.apiName.addContextMemory')}</span>
      </div>
    );
  }

  const isSuccess = pluginState?.memoryId;

  return (
    <div
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-user-memory.apiName.addContextMemory')}</span>
      {title && (
        <>
          : <span className={highlightTextStyles.primary}>{title}</span>
        </>
      )}
      {!isLoading && isSuccess && (
        <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
      )}
    </div>
  );
});

AddContextMemoryInspector.displayName = 'AddContextMemoryInspector';

export default AddContextMemoryInspector;

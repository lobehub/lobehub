'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { RemoveIdentityMemoryParams, RemoveIdentityMemoryState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  statusIcon: css`
    margin-block-end: -2px;
    margin-inline-start: 4px;
  `,
}));

export const RemoveIdentityMemoryInspector = memo<
  BuiltinInspectorProps<RemoveIdentityMemoryParams, RemoveIdentityMemoryState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const id = args?.id || partialArgs?.id;

  // Initial streaming state
  if (isArgumentsStreaming && !id) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-user-memory.apiName.removeIdentityMemory')}</span>
      </div>
    );
  }

  const isSuccess = pluginState?.identityId;

  return (
    <div
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-user-memory.apiName.removeIdentityMemory')}</span>
      {id && (
        <>
          : <span className={highlightTextStyles.warning}>{id}</span>
        </>
      )}
      {!isLoading && isSuccess && (
        <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
      )}
    </div>
  );
});

RemoveIdentityMemoryInspector.displayName = 'RemoveIdentityMemoryInspector';

export default RemoveIdentityMemoryInspector;

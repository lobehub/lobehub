'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { RemoveIdentityMemoryParams, RemoveIdentityMemoryState } from '../../../types';

const styles = stylex.create({ statusIcon: { marginBlockEnd: '-2px', marginInlineStart: '4px' } });

export const RemoveIdentityMemoryInspector = memo<
  BuiltinInspectorProps<RemoveIdentityMemoryParams, RemoveIdentityMemoryState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const id = args?.id || partialArgs?.id;

  // Initial streaming state
  if (isArgumentsStreaming && !id) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-user-memory.apiName.removeIdentityMemory')}
        </span>
      </div>
    );
  }

  const isSuccess = pluginState?.identityId;

  return (
    <div className={inspectorTextStyles.root}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-user-memory.apiName.removeIdentityMemory')}
      </span>
      {id && (
        <>
          :<span className={highlightTextStyles.warning}>{id}</span>
        </>
      )}
      {!isLoading && isSuccess && (
        <Check
          className={stylex.props(styles.statusIcon).className}
          color={cssVar.colorSuccess}
          size={14}
        />
      )}
    </div>
  );
});

RemoveIdentityMemoryInspector.displayName = 'RemoveIdentityMemoryInspector';

export default RemoveIdentityMemoryInspector;

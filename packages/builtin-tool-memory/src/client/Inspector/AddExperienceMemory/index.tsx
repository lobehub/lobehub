'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { AddExperienceMemoryParams, AddExperienceMemoryState } from '../../../types';

const styles = stylex.create({ statusIcon: { marginBlockEnd: '-2px', marginInlineStart: '4px' } });

export const AddExperienceMemoryInspector = memo<
  BuiltinInspectorProps<AddExperienceMemoryParams, AddExperienceMemoryState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const title = args?.title || partialArgs?.title;

  // Initial streaming state
  if (isArgumentsStreaming && !title) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-user-memory.apiName.addExperienceMemory')}
        </span>
      </div>
    );
  }

  const isSuccess = pluginState?.memoryId;

  return (
    <div className={inspectorTextStyles.root}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-user-memory.apiName.addExperienceMemory')}
      </span>
      {title && (
        <>
          :<span className={highlightTextStyles.primary}>{title}</span>
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

AddExperienceMemoryInspector.displayName = 'AddExperienceMemoryInspector';

export default AddExperienceMemoryInspector;

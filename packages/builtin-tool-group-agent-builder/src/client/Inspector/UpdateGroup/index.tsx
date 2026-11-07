'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { UpdateGroupParams, UpdateGroupState } from '../../../types';

const styles = stylex.create({ statusIcon: { marginBlockEnd: '-2px', marginInlineStart: '4px' } });

export const UpdateGroupInspector = memo<
  BuiltinInspectorProps<UpdateGroupParams, UpdateGroupState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const config = args?.config || partialArgs?.config;
  const meta = args?.meta || partialArgs?.meta;

  // Build display text from updated fields
  const displayText = useMemo(() => {
    const fields: string[] = [];
    // Config fields
    if (config?.openingMessage !== undefined) {
      fields.push(t('builtins.lobe-group-agent-builder.inspector.openingMessage'));
    }
    if (config?.openingQuestions !== undefined) {
      fields.push(t('builtins.lobe-group-agent-builder.inspector.openingQuestions'));
    }
    // Meta fields
    if (meta?.title !== undefined) {
      fields.push(t('builtins.lobe-group-agent-builder.inspector.title'));
    }
    if (meta?.description !== undefined) {
      fields.push(t('builtins.lobe-group-agent-builder.inspector.description'));
    }
    if (meta?.avatar !== undefined) {
      fields.push(t('builtins.lobe-group-agent-builder.inspector.avatar'));
    }
    if (meta?.backgroundColor !== undefined) {
      fields.push(t('builtins.lobe-group-agent-builder.inspector.backgroundColor'));
    }
    return fields.length > 0 ? fields.join(', ') : '';
  }, [config, meta, t]);

  // Initial streaming state
  if (isArgumentsStreaming && !displayText) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-group-agent-builder.apiName.updateGroup')}
        </span>
      </div>
    );
  }

  const isSuccess = pluginState?.success;

  return (
    <div className={inspectorTextStyles.root}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-group-agent-builder.apiName.updateGroup')}
      </span>
      {displayText && (
        <>
          :<span className={highlightTextStyles.primary}>{displayText}</span>
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

UpdateGroupInspector.displayName = 'UpdateGroupInspector';

export default UpdateGroupInspector;

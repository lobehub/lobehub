'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { UpdateGroupPromptParams, UpdateGroupPromptState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar: cv }) => ({
  groupName: css`
    overflow: hidden;

    max-width: 120px;

    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  label: css`
    flex-shrink: 0;
    color: ${cv.colorTextSecondary};
    white-space: nowrap;
  `,
  root: css`
    overflow: hidden;
    display: flex;
    gap: 6px;
    align-items: center;
  `,
}));

export const UpdateGroupPromptInspector = memo<
  BuiltinInspectorProps<UpdateGroupPromptParams, UpdateGroupPromptState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const prompt = args?.prompt || partialArgs?.prompt;

  // Calculate length difference
  const lengthDiff = useMemo(() => {
    if (!pluginState) return null;

    const newLength = pluginState.newPrompt?.length ?? 0;
    const prevLength = pluginState.previousPrompt?.length ?? 0;
    return newLength - prevLength;
  }, [pluginState]);

  // Initial streaming state
  if (isArgumentsStreaming && !prompt) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-group-agent-builder.apiName.updateGroupPrompt')}</span>
      </div>
    );
  }

  const streamingLength = prompt?.length ?? 0;

  return (
    <Flexbox
      horizontal
      align="center"
      className={cx(styles.root, (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}
      gap={6}
    >
      <span className={styles.label}>
        {t('builtins.lobe-group-agent-builder.apiName.updateGroupPrompt')}
      </span>
      {/* Show length diff when completed */}
      {!isLoading && !isArgumentsStreaming && lengthDiff !== null && (
        <Text
          code
          as="span"
          color={lengthDiff >= 0 ? cssVar.colorSuccess : cssVar.colorError}
          fontSize={12}
        >
          {lengthDiff >= 0 ? '+' : ''}
          {lengthDiff}
          {t('builtins.lobe-agent-builder.inspector.chars')}
        </Text>
      )}
      {/* Show streaming length */}
      {(isArgumentsStreaming || isLoading) && streamingLength > 0 && (
        <Text code as="span" color={cssVar.colorTextDescription} fontSize={12}>
          ({streamingLength}
          {t('builtins.lobe-agent-builder.inspector.chars')})
        </Text>
      )}
    </Flexbox>
  );
});

UpdateGroupPromptInspector.displayName = 'UpdateGroupPromptInspector';

export default UpdateGroupPromptInspector;

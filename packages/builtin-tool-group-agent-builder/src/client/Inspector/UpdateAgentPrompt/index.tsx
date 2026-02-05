'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { UpdateAgentPromptParams, UpdateAgentPromptState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar: cv }) => ({
  agentName: css`
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

    min-width: 0;
  `,
}));

export const UpdateAgentPromptInspector = memo<
  BuiltinInspectorProps<UpdateAgentPromptParams, UpdateAgentPromptState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const agentId = args?.agentId || partialArgs?.agentId;
  const prompt = args?.prompt || partialArgs?.prompt;

  // Get agent info from the current group
  const agent = useAgentGroupStore((s) => {
    const agents = agentGroupSelectors.currentGroupAgents(s);
    return agents.find((a) => a.id === agentId);
  });

  // Calculate length difference
  const lengthDiff = useMemo(() => {
    if (!pluginState) return null;

    const newLength = pluginState.newPrompt?.length ?? 0;
    const prevLength = pluginState.previousPrompt?.length ?? 0;
    return newLength - prevLength;
  }, [pluginState]);

  // Initial streaming state
  if (isArgumentsStreaming && !agentId) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-group-agent-builder.apiName.updateAgentPrompt')}</span>
      </div>
    );
  }

  const streamingLength = prompt?.length ?? 0;

  const isSupervisor = agent?.isSupervisor ?? false;

  // Use different i18n key for supervisor
  const labelKey = isSupervisor
    ? 'builtins.lobe-group-agent-builder.apiName.updateSupervisorPrompt'
    : 'builtins.lobe-group-agent-builder.apiName.updateAgentPrompt';

  return (
    <Flexbox
      horizontal
      align="center"
      className={cx(styles.root, (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}
      gap={6}
    >
      <span className={styles.label}>{t(labelKey)}</span>
      {/* Only show avatar and title for non-supervisor agents */}
      {agent && !isSupervisor && (
        <>
          <Avatar avatar={agent.avatar ?? undefined} size={18} title={agent.title ?? undefined} />
          <Text
            className={styles.agentName}
            ellipsis={{
              tooltipWhenOverflow: true,
            }}
          >
            {agent.title}
          </Text>
        </>
      )}
      {/* Show length diff when completed */}
      {!isLoading && !isArgumentsStreaming && lengthDiff !== null && (
        <Text
          code
          noWrap
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

UpdateAgentPromptInspector.displayName = 'UpdateAgentPromptInspector';

export default UpdateAgentPromptInspector;

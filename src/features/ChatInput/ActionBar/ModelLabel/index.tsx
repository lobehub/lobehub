import { Center, Flexbox, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import { memo, useCallback } from 'react';

import { useBusinessModelModeConfig } from '@/business/client/hooks/useBusinessAgentMode';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useActionBarContext } from '../context';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chevron: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  name: css`
    overflow: hidden;

    max-width: 160px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  trigger: css`
    cursor: pointer;
    border-radius: 6px;

    :hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  triggerDisabled: css`
    cursor: not-allowed;
    opacity: 0.5;

    :hover {
      background: transparent;
    }
  `,
}));

const ModelLabel = memo(() => {
  const { dropdownPlacement } = useActionBarContext();
  const { allowed: canCreateContent, reason } = usePermission('create_content');

  const agentId = useAgentId();
  const agentModel = useAgentStore(agentByIdSelectors.getAgentModelById(agentId));
  const agentProvider = useAgentStore(agentByIdSelectors.getAgentModelProviderById(agentId));
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const applyBusinessModelModeConfig = useBusinessModelModeConfig();

  const [activeTopicId, updateTopicMetadata] = useChatStore((s) => [
    s.activeTopicId,
    s.updateTopicMetadata,
  ]);
  const topicModelOverride = useChatStore((s) => {
    if (!activeTopicId) return undefined;
    const topic = topicSelectors.getTopicById(activeTopicId)(s);
    if (!topic?.metadata?.model) return undefined;
    return { model: topic.metadata.model, provider: topic.metadata.provider || '' };
  });

  const model = topicModelOverride?.model || agentModel;
  const provider = topicModelOverride?.provider || agentProvider;

  const enabledModel = useAiInfraStore(aiModelSelectors.getEnabledModelById(model, provider));
  const displayName = enabledModel?.displayName || model;

  const handleModelChange = useCallback(
    async (params: { model: string; provider: string }) => {
      if (!canCreateContent) return;

      const config = applyBusinessModelModeConfig(params);

      if (activeTopicId) {
        await updateTopicMetadata(activeTopicId, {
          model: config.model,
          provider: config.provider,
        });
      } else {
        await updateAgentConfigById(agentId, config);
      }
    },
    [
      activeTopicId,
      agentId,
      applyBusinessModelModeConfig,
      canCreateContent,
      updateAgentConfigById,
      updateTopicMetadata,
    ],
  );

  const trigger = (
    <Center
      horizontal
      className={cx(styles.trigger, !canCreateContent && styles.triggerDisabled)}
      height={28}
      paddingInline={6}
    >
      <Flexbox horizontal align={'center'} gap={2}>
        <span className={styles.name}>{displayName}</span>
        <ChevronDownIcon className={styles.chevron} size={12} />
      </Flexbox>
    </Center>
  );

  if (!canCreateContent)
    return (
      <Tooltip title={reason}>
        <div>{trigger}</div>
      </Tooltip>
    );

  return (
    <ModelSwitchPanel
      model={model}
      openOnHover={false}
      placement={dropdownPlacement}
      provider={provider}
      onModelChange={handleModelChange}
    >
      {trigger}
    </ModelSwitchPanel>
  );
});

ModelLabel.displayName = 'ModelLabel';

export default ModelLabel;

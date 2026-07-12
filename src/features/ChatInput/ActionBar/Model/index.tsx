import { ModelIcon } from '@lobehub/icons';
import { Center, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useCallback } from 'react';

import { useBusinessModelModeConfig } from '@/business/client/hooks/useBusinessAgentMode';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useActionBarContext } from '../context';

const styles = createStaticStyles(({ css, cssVar }) => ({
  icon: css`
    transition: scale 400ms cubic-bezier(0.215, 0.61, 0.355, 1);
  `,
  modelDisabled: css`
    cursor: not-allowed;
    opacity: 0.5;

    :hover {
      background: transparent;
    }

    :active {
      div {
        scale: 1;
      }
    }
  `,
  model: css`
    cursor: pointer;
    border-radius: 24px;

    :hover {
      background: ${cssVar.colorFillSecondary};
    }

    :active {
      div {
        scale: 0.8;
      }
    }
  `,
}));

const ModelSwitch = memo(() => {
  const { actionSize, dropdownPlacement } = useActionBarContext();
  const blockSize = actionSize?.blockSize ?? 32;
  const iconSize = actionSize?.size ?? 20;
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
      className={cx(styles.model, !canCreateContent && styles.modelDisabled)}
      height={blockSize}
      width={blockSize}
    >
      <div className={styles.icon}>
        <ModelIcon model={model} size={iconSize} />
      </div>
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
      placement={dropdownPlacement}
      provider={provider}
      onModelChange={handleModelChange}
    >
      {trigger}
    </ModelSwitchPanel>
  );
});

ModelSwitch.displayName = 'ModelSwitch';

export default ModelSwitch;

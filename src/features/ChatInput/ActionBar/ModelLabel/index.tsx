import { Center, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import { memo, useCallback } from 'react';

import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useAgentModelSelection } from '../../hooks/useAgentModelSelection';
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
  triggerReadonly: css`
    cursor: default;

    &:hover {
      background: transparent;
    }
  `,
}));

const ModelLabel = memo(() => {
  const { dropdownPlacement } = useActionBarContext();
  const agentId = useAgentId();
  const {
    canDisplayModel,
    canSelectModel,
    model: agentModel,
    provider: agentProvider,
    selectModel,
  } = useAgentModelSelection(agentId);
  // Topic-scoped model: a topic pins its own model (top-level `topics.model`
  // column). Display the topic's pinned model when present, else the agent
  // default; a switch pins to the active topic, otherwise updates the agent
  // (via selectModel, which honors workspace member overrides).
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const topicModel = useChatStore(topicSelectors.activeTopicModel);
  const updateTopicModel = useChatStore((s) => s.updateTopicModel);
  const model = topicModel?.model ?? agentModel;
  const provider = topicModel?.model ? topicModel.provider : agentProvider;

  const enabledModel = useAiInfraStore(aiModelSelectors.getEnabledModelById(model, provider));
  const displayName = enabledModel?.displayName || model;

  const handleModelChange = useCallback(
    async (params: { model: string; provider: string }) => {
      if (!canSelectModel) return;

      if (activeTopicId) await updateTopicModel(activeTopicId, params);
      else await selectModel(params);
    },
    [activeTopicId, canSelectModel, selectModel, updateTopicModel],
  );

  const trigger = (
    <Center
      horizontal
      aria-label={displayName}
      className={cx(styles.trigger, !canSelectModel && styles.triggerReadonly)}
      height={28}
      paddingInline={6}
    >
      <Flexbox horizontal align={'center'} gap={2}>
        <span className={styles.name}>{displayName}</span>
        {canSelectModel ? <ChevronDownIcon className={styles.chevron} size={12} /> : null}
      </Flexbox>
    </Center>
  );

  if (!canDisplayModel) return null;
  if (!canSelectModel) return trigger;

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

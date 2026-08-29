import { ModelIcon } from '@lobehub/icons';
import { Center, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useCallback } from 'react';

import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useAgentModelSelection } from '../../hooks/useAgentModelSelection';
import { useModelLockTooltip } from '../../hooks/useModelLockTooltip';
import { useReasoningEffortControl } from '../../hooks/useReasoningEffortControl';
import { useActionBarContext } from '../context';
import SelectorMenu from './SelectorMenu';

const styles = createStaticStyles(({ css, cssVar }) => ({
  icon: css`
    transition: scale 400ms cubic-bezier(0.215, 0.61, 0.355, 1);
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
  modelReadonly: css`
    cursor: default;

    :hover {
      background: transparent;
    }

    :active {
      div {
        scale: 1;
      }
    }
  `,
}));

const ModelSwitch = memo(() => {
  const { actionSize, dropdownPlacement } = useActionBarContext();
  const blockSize = actionSize?.blockSize ?? 32;
  const iconSize = actionSize?.size ?? 20;
  const agentId = useAgentId();
  const {
    canDisplayModel,
    canSelectModel,
    model: agentModel,
    provider: agentProvider,
    selectionLockReason,
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
  const lockTooltip = useModelLockTooltip(displayName, selectionLockReason);
  // Reasoning effort is a per-model user preference, so it rides along with the
  // model trigger instead of claiming a second action slot.
  const effort = useReasoningEffortControl(model, provider);
  // A pinned model still opens the menu when there is an effort to pick there.
  const interactive = canSelectModel || effort.hasReasoningParams;

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
      aria-disabled={!interactive}
      aria-label={displayName}
      className={cx(styles.model, !interactive && styles.modelReadonly)}
      height={blockSize}
      width={blockSize}
    >
      <div className={styles.icon}>
        <ModelIcon model={model} size={iconSize} />
      </div>
    </Center>
  );

  if (!canDisplayModel) return null;

  // Model + effort in one menu, so the two settings that decide how a turn runs
  // are picked in the same place (see SelectorMenu).
  if (effort.hasReasoningParams)
    return (
      <SelectorMenu
        canSelectModel={canSelectModel}
        displayName={displayName}
        effort={effort}
        model={model}
        placement={dropdownPlacement}
        provider={provider}
        onModelChange={handleModelChange}
      >
        {trigger}
      </SelectorMenu>
    );

  // Locked: say which model is pinned AND why it can't be changed here — the
  // bare model name used to leave the inert button unexplained.
  if (!canSelectModel) return <Tooltip title={lockTooltip ?? displayName}>{trigger}</Tooltip>;

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

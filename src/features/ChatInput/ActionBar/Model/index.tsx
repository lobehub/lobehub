import { Tooltip } from '@lobehub/ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

import SelectorTrigger from '../../components/SelectorTrigger';
import { useAgentId } from '../../hooks/useAgentId';
import { useAgentModelSelection } from '../../hooks/useAgentModelSelection';
import { useModelLockTooltip } from '../../hooks/useModelLockTooltip';
import { useReasoningEffortControl } from '../../hooks/useReasoningEffortControl';
import { useActionBarContext } from '../context';
import SelectorMenu from './SelectorMenu';

const ModelSwitch = memo(() => {
  const { t } = useTranslation('chat');
  const { dropdownPlacement } = useActionBarContext();
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

  // Both current values in one label, the way the heterogeneous selector reads:
  // "GPT-5.6 Sol 中". The effort half is dropped for models without one.
  const effortLabel = effort.effortValue
    ? t(`reasoningEffort.levels.${effort.effortValue}`)
    : undefined;
  const triggerText = effortLabel ? `${displayName} ${effortLabel}` : displayName;

  const trigger = (
    <SelectorTrigger
      aria-disabled={!interactive}
      ariaLabel={triggerText}
      text={triggerText}
      {...(interactive ? {} : { style: { cursor: 'default' } })}
    />
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
        placement={dropdownPlacement ?? 'topRight'}
        provider={provider}
        onModelChange={handleModelChange}
      >
        {trigger}
      </SelectorMenu>
    );

  // Locked: say which model is pinned AND why it can't be changed here — the
  // bare model name used to leave the inert chip unexplained.
  if (!canSelectModel) return <Tooltip title={lockTooltip ?? displayName}>{trigger}</Tooltip>;

  return (
    <ModelSwitchPanel
      model={model}
      openOnHover={false}
      placement={dropdownPlacement ?? 'topRight'}
      provider={provider}
      onModelChange={handleModelChange}
    >
      {trigger}
    </ModelSwitchPanel>
  );
});

ModelSwitch.displayName = 'ModelSwitch';

export default ModelSwitch;

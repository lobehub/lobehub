import { Alert, Tooltip } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AGENT_SHARE_ALLOWED_PROVIDERS } from '@/business/agent-share';
import { useAgentShareSupported } from '@/business/client/useAgentShareSupported';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import SelectorTrigger from '../../components/SelectorTrigger';
import { useAgentId } from '../../hooks/useAgentId';
import { useAgentModelSelection } from '../../hooks/useAgentModelSelection';
import { useModelLockTooltip } from '../../hooks/useModelLockTooltip';
import { useReasoningEffortControl } from '../../hooks/useReasoningEffortControl';
import { useActionBarContext } from '../context';
import SelectorMenu from './SelectorMenu';
import { useTopicModelSwitch } from './useTopicModelSwitch';

const ModelSwitch = memo(() => {
  const { t } = useTranslation(['chat', 'agent']);
  const { dropdownPlacement } = useActionBarContext();
  const agentId = useAgentId();
  const selection = useAgentModelSelection(agentId);
  const { canDisplayModel, canSelectModel, selectionLockReason } = selection;
  // The composer topic's pin when present, else the agent selection; a switch
  // pins that topic, otherwise updates the agent.
  const {
    model,
    provider,
    switchModel: handleModelChange,
    topicId,
  } = useTopicModelSwitch(selection);
  const { isShared } = useAgentShareSupported(agentId);
  const chatModels = useEnabledChatModels();
  const enabledList =
    !topicId && isShared && AGENT_SHARE_ALLOWED_PROVIDERS
      ? chatModels.filter((item) => AGENT_SHARE_ALLOWED_PROVIDERS?.includes(item.id))
      : undefined;
  const modelNotice = enabledList ? (
    <Alert
      showIcon
      description={t('share.settings.modelRestriction.description', { ns: 'agent' })}
      title={t('share.settings.modelRestriction.title', { ns: 'agent' })}
      type={'info'}
    />
  ) : undefined;
  const enabledModel = useAiInfraStore(aiModelSelectors.getEnabledModelById(model, provider));
  const displayName = enabledModel?.displayName || model;
  const lockTooltip = useModelLockTooltip(displayName, selectionLockReason);
  // Reasoning effort rides along with the model trigger instead of claiming a
  // second action slot. Like the model, it pins to the composer's topic when
  // there is one and edits the user's per-model default otherwise.
  const effort = useReasoningEffortControl(model, provider, topicId ?? undefined);
  // A pinned model still opens the menu when there is an effort to pick there.
  const interactive = canSelectModel || effort.hasReasoningParams;

  // Both current values on one chip, the way the heterogeneous selector reads:
  // "GPT-5.6 Sol 中". The effort half is dropped for models without one; the
  // chip keeps the two halves apart so the effort is never ellipsised away.
  const effortLabel = effort.effortValue
    ? t(`reasoningEffort.levels.${effort.effortValue}`)
    : undefined;
  const triggerText = effortLabel ? `${displayName} ${effortLabel}` : displayName;

  const trigger = (
    <SelectorTrigger
      aria-disabled={!interactive}
      ariaLabel={triggerText}
      secondaryText={effortLabel}
      text={displayName}
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
        enabledList={enabledList}
        model={model}
        modelNotice={modelNotice}
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
      enabledList={enabledList}
      model={model}
      notice={modelNotice}
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

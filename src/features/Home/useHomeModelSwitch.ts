import { useTranslation } from 'react-i18next';

import type { BusinessModelModeConfig } from '@/business/client/hooks/useBusinessAgentMode';
import { useBusinessModelModeConfig } from '@/business/client/hooks/useBusinessAgentMode';
import { useAgentModelSelection } from '@/features/ChatInput/hooks/useAgentModelSelection';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

interface ModelTarget {
  model: string;
  provider: string;
}

/**
 * - `inUse`: already the caller's model, nothing written.
 * - `switched`: the caller's model now is the target.
 * - `loading`: the Agent, its access or the caller's preference is still
 *   loading (see `isReady`), nothing written.
 * - `locked`: the caller may not switch this Agent's model (see `lockTip`).
 * - `failed`: the write was rejected.
 */
export type HomeModelSwitchResult = 'failed' | 'inUse' | 'loading' | 'locked' | 'switched';

/**
 * Switch the Home Agent's model from a Home entry point (new-model shortcuts,
 * model promos) through the same read/write path as the input's model trigger.
 *
 * A shared Workspace Agent such as the Workspace Inbox keeps a per-member model
 * override. Writing its Agent row instead would leave the trigger (and the chat
 * page) on the member's old model and repoint every other member's default.
 */
export const useHomeModelSwitch = (agentId: string | undefined) => {
  const selection = useAgentModelSelection(agentId ?? '');
  const isAgentLoaded = useAgentStore((s) => !!agentId && !!s.agentMap[agentId]);
  const applyBusinessModelModeConfig = useBusinessModelModeConfig();
  const { t } = useTranslation(['chat', 'setting']);

  // `selection` resolves from the loaded Agent row (whether the caller edits
  // the row or their own override); acting before it loads would pick the
  // wrong target. `canDisplayModel` settles once access and preference load.
  const isReady = !!agentId && isAgentLoaded && selection.canDisplayModel;
  // Same wording as the input's locked model trigger (`useModelLockTooltip`).
  const lockTip =
    selection.selectionLockReason === 'fixedByAgent'
      ? t('chat:input.modelFixedTip')
      : selection.selectionLockReason === 'useOnly'
        ? t('setting:permission.accessTag.useOnlyTip')
        : undefined;

  const switchModel = async (target: ModelTarget): Promise<HomeModelSwitchResult> => {
    if (!agentId || !isReady) return 'loading';
    if (!selection.canSelectModel) return 'locked';

    // The model-mode side effect (e.g. leaving Agent mode) only applies to the
    // Agent row; a member override stores the model alone.
    const nextConfig: BusinessModelModeConfig = applyBusinessModelModeConfig(target);
    const shouldUpdateAgentMode =
      !selection.usesWorkspaceMemberSelection &&
      nextConfig.chatConfig?.enableAgentMode === false &&
      agentByIdSelectors.getAgentEnableModeById(agentId)(useAgentStore.getState());

    if (
      selection.model === target.model &&
      selection.provider === target.provider &&
      !shouldUpdateAgentMode
    )
      return 'inUse';

    try {
      const switched = await selection.selectModel(target, {
        rethrow: true,
        showErrorMessage: false,
      });
      // `false` only when the preference was still settling.
      return switched ? 'switched' : 'loading';
    } catch {
      return 'failed';
    }
  };

  return {
    isReady,
    lockTip,
    model: selection.model,
    provider: selection.provider,
    switchModel,
  };
};

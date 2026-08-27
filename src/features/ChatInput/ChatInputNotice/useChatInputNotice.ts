import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useAgentModelSelection } from '@/features/ChatInput/hooks/useAgentModelSelection';
import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import {
  resolveEnableTargetProviderId,
  resolveStaleModelState,
} from '@/features/ModelSelect/resolveStaleModelState';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

interface ResolveChatInputNoticeParams {
  currentChatModel?: unknown;
  isAgentModelPending: boolean;
  isGroupContext?: boolean;
  isHeterogeneousAgent: boolean;
  isModelConfigReady: boolean;
  isModelDisabled?: boolean;
  isResourceViewOnly?: boolean;
}

const findEnabledChatModel = (
  enabledChatModelList: EnabledProviderWithModels[],
  model: string,
  provider: string,
) => {
  return enabledChatModelList
    .find((item) => item.id === provider)
    ?.children.find((item) => item.id === model);
};

export const resolveChatInputNotice = ({
  currentChatModel,
  isAgentModelPending,
  isGroupContext,
  isHeterogeneousAgent,
  isModelDisabled,
  isModelConfigReady,
  isResourceViewOnly,
}: ResolveChatInputNoticeParams) => {
  // View-level General access on the bound agent/group makes the whole input
  // read-only — that outranks any model-config notice (nothing can be sent).
  if (isResourceViewOnly)
    return {
      action: undefined,
      key: isGroupContext ? 'input.viewOnlyGroup' : 'input.viewOnlyAgent',
      type: 'warning',
    } as const;

  // Model-config notices don't apply to heterogeneous agents (own toolchain),
  // before the model runtime config is ready, or before the agent's effective
  // model is settled. The last one matters on a cold page load: until
  // `agentMap` has the agent (and, for a member-selection workspace agent,
  // until the member override is fetched), the model resolves to the
  // DEFAULT_MODEL/DEFAULT_PROVIDER fallback, which is often absent from the
  // user's enabled list — that used to flash the "model offline" warning for a
  // frame before the real config resolved.
  if (
    !isHeterogeneousAgent &&
    isModelConfigReady &&
    !isAgentModelPending && // Example: an agent still references `gpt-4-32k`, or a model reclassified to
    // image/video; once absent from the chat selector, it should read as unavailable.
    !currentChatModel
  ) {
    if (isModelDisabled)
      return {
        action: 'enableModel' as const,
        key: 'input.modelDisabled',
        type: 'warning',
      } as const;

    return { action: undefined, key: 'input.modelUnavailable', type: 'warning' } as const;
  }

  // Use-level General access (can chat, can't edit the shared config) is
  // deliberately NOT a notice: a standing "you can only use this agent" banner
  // states a permission without naming what it blocks. The locked
  // controls explain themselves instead — see `useModelLockTooltip` for the
  // model triggers and the fixed-target tooltip on the device chip.
};

/** Union of every notice shape `resolveChatInputNotice` can return. */
export type ChatInputNotice = NonNullable<ReturnType<typeof resolveChatInputNotice>> & {
  actionDisabled?: boolean;
  actionDisabledReason?: string;
  actionLoading?: boolean;
  onAction?: () => Promise<void>;
};

export const useChatInputNotice = (): ChatInputNotice | undefined => {
  const { t } = useTranslation('chat');
  const { allowed: canManageAiInfra, reason: aiInfraPermissionReason } =
    usePermission('manage_provider_key');
  const agentId = useAgentId();
  const [actionLoading, setActionLoading] = useState(false);

  const [isAgentConfigLoading, isHeterogeneousAgent] = useAgentStore((s) => [
    agentByIdSelectors.isAgentConfigLoadingById(agentId)(s),
    agentByIdSelectors.isAgentHeterogeneousById(agentId)(s),
  ]);

  // Same source as the model trigger renders, so the notice can never judge a
  // different model than the one the user sees (member overrides included).
  const { canSelectModel, isPreferenceLoading, model, provider, selectModel, selectionPolicy } =
    useAgentModelSelection(agentId);

  // `isPreferenceLoading` is true for every workspace agent while the shared
  // preferences request is in flight, but the override only feeds the
  // effective model under the `member` policy (`resolveAgentModelConfig`).
  // Waiting on it for a `fixed` agent would swallow a genuine warning.
  const isMemberOverridePending = selectionPolicy === 'member' && isPreferenceLoading;

  const enabledChatModelList = useEnabledChatModels();
  const builtinAiModelList = useAiInfraStore((s) => s.builtinAiModelList);
  const enabledAiProviders = useAiInfraStore((s) => s.enabledAiProviders);
  const modelRedirects = useAiInfraStore((s) => s.modelRedirects);
  const toggleProviderEnabled = useAiInfraStore((s) => s.toggleProviderEnabled);
  const toggleProviderModelEnabled = useAiInfraStore((s) => s.toggleProviderModelEnabled);
  const isModelConfigReady = useAiInfraStore((s) =>
    aiProviderSelectors.isInitAiProviderRuntimeState(s),
  );
  const currentChatModel = findEnabledChatModel(enabledChatModelList, model, provider);
  const staleModelState = useMemo(
    () =>
      isModelConfigReady
        ? resolveStaleModelState(
            { model, provider },
            {
              builtinAiModelList,
              enabledList: enabledChatModelList,
              modelRedirects,
              modelType: 'chat',
            },
          )
        : undefined,
    [builtinAiModelList, enabledChatModelList, isModelConfigReady, model, modelRedirects, provider],
  );
  const enableTargetProviderId =
    staleModelState?.status === 'notEnabled'
      ? resolveEnableTargetProviderId(
          { model, provider },
          {
            enabledAiProviders,
            enabledList: enabledChatModelList,
            metaProviderId: staleModelState.meta?.providerId,
          },
        )
      : undefined;
  /**
   * A locked Agent selection can only be repaired in place. Enabling an id-only fallback
   * provider would mutate global model settings while leaving the persisted selection stale.
   */
  const isModelDisabled = Boolean(
    enableTargetProviderId && (enableTargetProviderId === provider || canSelectModel),
  );
  const { canUseResource, isGroupContext } = useChatInputResourceAccess();

  const notice = resolveChatInputNotice({
    currentChatModel,
    isAgentModelPending: isAgentConfigLoading || isMemberOverridePending,
    isGroupContext,
    isHeterogeneousAgent,
    isModelDisabled,
    isModelConfigReady,
    isResourceViewOnly: !canUseResource,
  });

  const handleEnableModel = useCallback(async () => {
    const providerId = enableTargetProviderId;
    if (!providerId) return;

    setActionLoading(true);
    try {
      if (!enabledChatModelList.some((item) => item.id === providerId)) {
        await toggleProviderEnabled(providerId, true);
      }
      await toggleProviderModelEnabled({
        enabled: true,
        id: model,
        providerId,
        type: 'chat',
      });
      if (providerId !== provider) {
        try {
          await selectModel({ model, provider: providerId });
        } catch (error) {
          console.error('Failed to select the enabled chat model provider:', error);
          toast.error(t('input.modelDisabled.selectionFailed'));
        }
      }
    } catch (error) {
      console.error('Failed to enable the selected chat model:', error);
      toast.error(t('input.modelDisabled.actionFailed'));
    } finally {
      setActionLoading(false);
    }
  }, [
    enableTargetProviderId,
    enabledChatModelList,
    model,
    provider,
    selectModel,
    t,
    toggleProviderEnabled,
    toggleProviderModelEnabled,
  ]);

  if (notice?.action !== 'enableModel') return notice;

  return {
    ...notice,
    actionDisabled: !canManageAiInfra,
    actionDisabledReason: canManageAiInfra ? undefined : aiInfraPermissionReason,
    actionLoading,
    onAction: canManageAiInfra ? handleEnableModel : undefined,
  };
};

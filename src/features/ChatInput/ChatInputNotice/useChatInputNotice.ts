import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useAgentModelSelection } from '@/features/ChatInput/hooks/useAgentModelSelection';
import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import { useTopicId } from '@/features/ChatInput/hooks/useTopicId';
import {
  resolveEnableTargetProviderId,
  resolveStaleModelState,
} from '@/features/ModelSelect/resolveStaleModelState';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

interface ResolveChatInputNoticeParams {
  currentChatModel?: unknown;
  isEffectiveModelPending: boolean;
  isGroupContext?: boolean;
  isHeterogeneousAgent: boolean;
  isModelConfigReady: boolean;
  isModelDisabled?: boolean;
  isResourceViewOnly?: boolean;
}

interface ResolvedChatInputNotice {
  action?: 'enableModel';
  key:
    | 'input.agentModeUnsupportedModel'
    | 'input.modelDisabled'
    | 'input.modelUnavailable'
    | 'input.viewOnlyAgent'
    | 'input.viewOnlyGroup';
  type: 'warning';
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

/**
 * Resolves every persistent notice that applies to the active chat input.
 *
 * Use when:
 * - Rendering the compact notice summary and its expanded stack
 * - Inspecting simultaneous permission and model configuration problems
 *
 * Expects:
 * - Fully resolved resource access and effective model state
 *
 * Returns:
 * - Notices ordered from the broadest input blocker to narrower configuration issues
 */
export const resolveChatInputNotices = ({
  currentChatModel,
  isEffectiveModelPending,
  isGroupContext,
  isHeterogeneousAgent,
  isModelDisabled,
  isModelConfigReady,
  isResourceViewOnly,
}: ResolveChatInputNoticeParams) => {
  const notices: ResolvedChatInputNotice[] = [];

  // View-level General access on the bound agent/group makes the whole input
  // read-only. Keep it first so legacy single-notice consumers retain their
  // blocker-first behavior while the stack can still explain narrower issues.
  if (isResourceViewOnly)
    notices.push({
      action: undefined,
      key: isGroupContext ? 'input.viewOnlyGroup' : 'input.viewOnlyAgent',
      type: 'warning',
    });

  // Model-config notices don't apply to heterogeneous agents (own toolchain),
  // before the model runtime config is ready, or before the effective model is
  // settled. The last one matters on a cold page load: until `agentMap` has the
  // agent (and, for a member-selection workspace agent, until the member
  // override is fetched, and for a topic-pinned model until the topic row is
  // loaded), the model resolves to the DEFAULT_MODEL/DEFAULT_PROVIDER fallback
  // or the agent default, which is often absent from the user's enabled list —
  // that used to flash the "model offline" warning for a frame before the real
  // config resolved.
  if (
    !isHeterogeneousAgent &&
    isModelConfigReady &&
    !isEffectiveModelPending && // Example: an agent still references `gpt-4-32k`, or a model reclassified to
    // image/video; once absent from the chat selector, it should read as unavailable.
    !currentChatModel
  ) {
    if (isModelDisabled)
      notices.push({
        action: 'enableModel' as const,
        key: 'input.modelDisabled',
        type: 'warning',
      });
    else notices.push({ key: 'input.modelUnavailable', type: 'warning' });
  }

  // Use-level General access (can chat, can't edit the shared config) is
  // deliberately NOT a notice: a standing "you can only use this agent" banner
  // states a permission without naming what it blocks. The locked
  // controls explain themselves instead — see `useModelLockTooltip` for the
  // model triggers and the fixed-target tooltip on the device chip.
  return notices;
};

/**
 * Resolves the highest-priority notice for legacy single-notice consumers.
 *
 * Use when:
 * - A surface can render only one notice
 *
 * Expects:
 * - The same resolved state accepted by {@link resolveChatInputNotices}
 *
 * Returns:
 * - The first applicable notice, or undefined when the input has no notice
 */
export const resolveChatInputNotice = (params: ResolveChatInputNoticeParams) =>
  resolveChatInputNotices(params)[0];

/** Union of every notice shape `resolveChatInputNotice` can return. */
export type ChatInputNotice = NonNullable<ReturnType<typeof resolveChatInputNotice>> & {
  actionDisabled?: boolean;
  actionDisabledReason?: string;
  actionLoading?: boolean;
  onAction?: () => Promise<void>;
};

/**
 * Collects all persistent notices for the active chat input.
 *
 * Use when:
 * - Rendering the notice summary and expandable stack beside the composer actions
 *
 * Expects:
 * - Chat, agent, permission, and model stores to be available through their providers
 *
 * Returns:
 * - Ordered notices with any available recovery action attached
 */
export const useChatInputNotices = (): ChatInputNotice[] => {
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
  const {
    canSelectModel,
    isPreferenceLoading,
    model: agentModel,
    provider: agentProvider,
    selectModel,
    selectionPolicy,
  } = useAgentModelSelection(agentId);

  // …and the trigger resolves topic-first: a topic pins its own model
  // (`topics.model`), which outranks the agent default for everything that
  // actually runs (see `useEffectiveModel`). Judging the agent model here
  // warned "the current model is disabled" over a perfectly usable topic model,
  // and its Enable action then repaired the agent row nobody was using.
  // The topic comes from this composer's own conversation, never the global
  // active topic — see `useTopicId`.
  const topicId = useTopicId();
  const topicModel = useChatStore((s) =>
    topicId ? topicSelectors.getTopicModelById(topicId)(s) : undefined,
  );
  const hasTopicRow = useChatStore((s) => !!topicId && !!topicSelectors.getTopicById(topicId)(s));
  const updateTopicModel = useChatStore((s) => s.updateTopicModel);
  // The main chat's topic row arrives with the sidebar list (or its detail
  // fetch) a beat after the route makes it active; until then it reads as "no
  // pin" and would fall back to the agent default — the same cold-load flash as
  // above. Only that topic is worth waiting on: a host-owned topic that is never
  // listed (a document's chat panel is a system topic) would otherwise suppress
  // the notice for good, so it is judged by its agent default instead.
  const isActiveTopicPending = useChatStore(
    (s) => !!topicId && topicId === s.activeTopicId && !topicSelectors.getTopicById(topicId)(s),
  );
  const model = topicModel?.model ?? agentModel;
  const provider = topicModel?.model ? topicModel.provider : agentProvider;

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

  const notices = resolveChatInputNotices({
    currentChatModel,
    isEffectiveModelPending:
      isAgentConfigLoading || isMemberOverridePending || isActiveTopicPending,
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
          // Re-point the row the judged model came from, the way the model
          // trigger's own switch routes: this conversation's topic when its row
          // is known, the agent (or member override) otherwise — an unlisted
          // topic was judged by its agent default, so that is what gets fixed.
          if (topicId && hasTopicRow)
            await updateTopicModel(topicId, { model, provider: providerId });
          else await selectModel({ model, provider: providerId });
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
    hasTopicRow,
    model,
    provider,
    selectModel,
    t,
    toggleProviderEnabled,
    toggleProviderModelEnabled,
    topicId,
    updateTopicModel,
  ]);

  return notices.map((notice) =>
    notice.action === 'enableModel'
      ? {
          ...notice,
          actionDisabled: !canManageAiInfra,
          actionDisabledReason: canManageAiInfra ? undefined : aiInfraPermissionReason,
          actionLoading,
          onAction: canManageAiInfra ? handleEnableModel : undefined,
        }
      : notice,
  );
};

/**
 * Returns the highest-priority persistent notice for compatibility.
 *
 * Use when:
 * - A caller has not adopted the multi-notice stack yet
 *
 * Expects:
 * - The same providers required by {@link useChatInputNotices}
 *
 * Returns:
 * - The first notice, or undefined when no notice applies
 */
export const useChatInputNotice = (): ChatInputNotice | undefined => useChatInputNotices()[0];

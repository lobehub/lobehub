'use client';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { setAgentTemplatesFetcher } from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import type { SendMessageParams } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { ErrorBoundary, Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Drawer } from 'antd';
import { History } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/BrandTextLoading';
import { ONBOARDING_PRODUCTION_DEFAULT_MODEL } from '@/const/onboarding';
import { type ConversationHooks } from '@/features/Conversation/types';
import { mergeConversationHooks } from '@/features/Conversation/utils/mergeConversationHooks';
import ModeSwitch from '@/features/Onboarding/components/ModeSwitch';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useOnboardingAgentTemplates } from '@/hooks/useOnboardingAgentTemplates';
import { useClientDataSWR, useOnlyFetchOnceSWR } from '@/libs/swr';
import { onboardingKeys } from '@/libs/swr/keys';
import OnboardingContainer from '@/routes/onboarding/_layout';
import { fetchOnboardingAgentTemplates } from '@/services/agentMarketplace';
import {
  trackOnboardingCompleted,
  trackOnboardingStepCompleted,
  trackOnboardingStepViewed,
} from '@/services/onboardingMetrics';
import { topicService } from '@/services/topic';
import { userService } from '@/services/user';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useUserStore } from '@/store/user';
import { isDev } from '@/utils/env';
import { peekOnboardingCallbackUrl } from '@/utils/onboardingRedirect';

import AnalyticsBridge from './AnalyticsBridge';
import { resolveAgentOnboardingContext } from './context';
import AgentOnboardingConversation from './Conversation';
import AgentOnboardingDebugExportButton from './DebugExportButton';
import HistoryPanel from './HistoryPanel';
import OnboardingConversationProvider from './OnboardingConversationProvider';
import { useOnboardingFollowUp } from './useOnboardingFollowUp';

const CLASSIC_ONBOARDING_PATH = '/onboarding/classic';

const RedirectToClassicOnboarding = memo(() => {
  const navigate = useWorkspaceAwareNavigate();

  useEffect(() => {
    navigate(CLASSIC_ONBOARDING_PATH, { replace: true });
  }, [navigate]);

  return <Loading debugId="AgentOnboardingRedirectClassic" />;
});
RedirectToClassicOnboarding.displayName = 'RedirectToClassicOnboarding';

const AgentOnboardingPage = memo(() => {
  const { t } = useTranslation('onboarding');
  const useInitBuiltinAgent = useAgentStore((s) => s.useInitBuiltinAgent);
  const refreshBuiltinAgent = useAgentStore((s) => s.refreshBuiltinAgent);
  const onboardingAgentId = useAgentStore(
    builtinAgentSelectors.getBuiltinAgentId(BUILTIN_AGENT_SLUGS.webOnboarding),
  );
  const onboardingAgentConfig = useAgentStore((s) =>
    onboardingAgentId ? agentByIdSelectors.getAgentConfigById(onboardingAgentId)(s) : undefined,
  );
  const inboxAgentId = useAgentStore(
    builtinAgentSelectors.getBuiltinAgentId(BUILTIN_AGENT_SLUGS.inbox),
  );
  const [agentOnboarding, refreshUserState, resetAgentOnboarding] = useUserStore((s) => [
    s.agentOnboarding,
    s.refreshUserState,
    s.resetAgentOnboarding,
  ]);
  const [isResetting, setIsResetting] = useState(false);
  const [selectedTopicId, setSelectedTopicId] = useState<string>();
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);

  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.webOnboarding);

  useEffect(() => {
    setAgentTemplatesFetcher(fetchOnboardingAgentTemplates);
  }, []);

  const { data: historyData, mutate: mutateHistoryTopics } = useClientDataSWR(
    isDev && onboardingAgentId ? onboardingKeys.agentHistoryTopics(onboardingAgentId) : null,
    () =>
      topicService.getTopics({
        agentId: onboardingAgentId,
        pageSize: 100,
      }),
  );

  const { data, error, isLoading, mutate } = useOnlyFetchOnceSWR(
    onboardingKeys.agentBootstrap(),
    () => userService.getOnboardingBootstrapState(),
    {
      onSuccess: async () => {
        await refreshUserState();
        if (isDev && onboardingAgentId) await mutateHistoryTopics();
      },
    },
  );

  const currentContext = useMemo(
    () =>
      resolveAgentOnboardingContext({
        bootstrapContext: data,
        storedAgentOnboarding: agentOnboarding,
      }),
    [agentOnboarding, data],
  );
  // bootstrap topicId is now `string | null` for fresh users — coerce null to
  // undefined so the rest of the code's optional-chaining behavior is preserved.
  const bootstrapTopicId = data?.topicId ?? undefined;
  const activeTopicId = currentContext.topicId || bootstrapTopicId;
  const hasMessages = !!data?.hasMessages;
  const historyTopics = historyData?.items || [];
  const effectiveTopicId = selectedTopicId || activeTopicId;
  const onboardingFinished = !!agentOnboarding?.finishedAt;
  const finishTargetUrl = useMemo(() => {
    if (!onboardingFinished || !inboxAgentId || !effectiveTopicId) return undefined;
    return AGENT_CHAT_TOPIC_URL(inboxAgentId, effectiveTopicId);
  }, [onboardingFinished, inboxAgentId, effectiveTopicId]);

  const viewingHistoricalTopic =
    !!activeTopicId && !!effectiveTopicId && effectiveTopicId !== activeTopicId;

  useOnboardingAgentTemplates(!onboardingFinished && !viewingHistoricalTopic);

  const conversationViewedRef = useRef(false);
  useEffect(() => {
    if (
      conversationViewedRef.current ||
      !onboardingAgentId ||
      onboardingFinished ||
      viewingHistoricalTopic
    ) {
      return;
    }

    conversationViewedRef.current = true;
    trackOnboardingStepViewed({
      flow: 'agent',
      step: 'conversation',
      stepIndex: 1,
    });
  }, [onboardingAgentId, onboardingFinished, viewingHistoricalTopic]);

  const onboardingChatKey = useMemo(
    () => messageMapKey({ agentId: onboardingAgentId || '', topicId: effectiveTopicId }),
    [onboardingAgentId, effectiveTopicId],
  );
  const messagesForOnboarding = useChatStore((s) => s.dbMessagesMap[onboardingChatKey]);
  // No persisted welcome message: greeting = no messages yet.
  const isGreeting = useMemo(
    () => !messagesForOnboarding || messagesForOnboarding.length === 0,
    [messagesForOnboarding],
  );
  const onboardingFollowUpModelConfig = useMemo(
    () => ({
      model: onboardingAgentConfig?.model ?? ONBOARDING_PRODUCTION_DEFAULT_MODEL.model,
      provider: onboardingAgentConfig?.provider ?? ONBOARDING_PRODUCTION_DEFAULT_MODEL.provider,
    }),
    [onboardingAgentConfig?.model, onboardingAgentConfig?.provider],
  );

  const onboardingFollowUpHooks = useOnboardingFollowUp({
    enabled: !onboardingFinished && !viewingHistoricalTopic,
    isGreeting,
    modelConfig: onboardingFollowUpModelConfig,
    onboardingAgentId,
    phase: data?.context?.phase,
    topicId: effectiveTopicId,
  });

  // Re-entry latch for the fresh-state first-send orchestration. The combination
  // of advisory lock + this ref ensures rapid double-submit cannot create two
  // user messages: the second invocation awaits the same in-flight promise
  // instead of dispatching its own sendMessage. See spec Revision 3.
  const firstSendInFlightRef = useRef<Promise<void> | null>(null);

  const composedOnBeforeSendMessage = useCallback(
    async (params: SendMessageParams): Promise<boolean> => {
      params.metadata = { ...params.metadata, trigger: RequestTrigger.Onboarding };

      if (!onboardingAgentId) {
        // ChatInput is gated by `isInputReady`; this branch should be unreachable.
        return false;
      }

      // Returning / edge: topic exists — let the normal sendMessage path proceed.
      if (effectiveTopicId) return true;

      // Fresh: orchestrate first-send ourselves and block the wrapping path.
      if (firstSendInFlightRef.current) {
        await firstSendInFlightRef.current;
        return false;
      }

      const orchestration = (async () => {
        try {
          const { topicId: serverTopicId, messages } = await userService.sendOnboardingFirstMessage(
            {
              agentId: onboardingAgentId,
            },
          );

          const key = messageMapKey({ agentId: onboardingAgentId, topicId: serverTopicId });
          useChatStore.setState((state) => ({
            dbMessagesMap: { ...state.dbMessagesMap, [key]: messages },
          }));

          // Update the page's own topic pointer + the SWR cache so subsequent
          // renders route through the returning / edge branch.
          setSelectedTopicId(serverTopicId);
          await mutate(
            (prev) => (prev ? { ...prev, hasMessages: true, topicId: serverTopicId } : prev),
            { revalidate: false },
          );

          // Dispatch the real send directly into useChatStore.sendMessage with an
          // EXPLICIT context, bypassing the conversation-store wrapper whose
          // context still points at the (now-stale) undefined topicId. This avoids
          // accidentally entering sendMessageInServer's new-topic creation branch.
          await useChatStore.getState().sendMessage({
            ...params,
            context: { agentId: onboardingAgentId, topicId: serverTopicId },
            messages,
          });
        } finally {
          firstSendInFlightRef.current = null;
        }
      })();

      firstSendInFlightRef.current = orchestration;
      await orchestration;
      return false;
    },
    [effectiveTopicId, mutate, onboardingAgentId],
  );

  const syncOnboardingContext = useCallback(async () => {
    const nextContext = await userService.getOnboardingBootstrapState();
    await mutate(nextContext, { revalidate: false });
    if (isDev && onboardingAgentId) await mutateHistoryTopics();

    return nextContext;
  }, [mutate, mutateHistoryTopics, onboardingAgentId]);

  const trackAgentOnboardingCompletion = useCallback(
    (topicId: string | undefined) => {
      trackOnboardingStepCompleted({
        flow: 'agent',
        step: 'conversation',
        stepIndex: 1,
      });
      trackOnboardingCompleted({
        flow: 'agent',
        hasTopic: !!topicId,
        targetUrl:
          // A threaded signup target (if any) wins over the onboarding topic on finish
          peekOnboardingCallbackUrl() ??
          (inboxAgentId && topicId ? AGENT_CHAT_TOPIC_URL(inboxAgentId, topicId) : undefined),
      });
    },
    [inboxAgentId],
  );

  const handleAfterWrapUp = useCallback(async () => {
    const nextContext = await syncOnboardingContext();
    trackAgentOnboardingCompletion(nextContext.topicId ?? effectiveTopicId);
  }, [effectiveTopicId, syncOnboardingContext, trackAgentOnboardingCompletion]);

  const onboardingTurnSettledHook = useMemo<ConversationHooks>(() => {
    if (onboardingFinished || viewingHistoricalTopic) return {};

    return {
      onAssistantTurnSettled: async () => {
        if (!effectiveTopicId) return;

        const prevPhase = data?.context?.phase;
        const prevFinishedAt = agentOnboarding?.finishedAt;

        const nextContext = await syncOnboardingContext();
        const newPhase = nextContext?.context?.phase;
        const newFinishedAt = nextContext?.agentOnboarding?.finishedAt;

        const refreshes: Promise<unknown>[] = [];
        if (newFinishedAt && newFinishedAt !== prevFinishedAt) {
          trackAgentOnboardingCompletion(effectiveTopicId);
        }
        if (newFinishedAt !== prevFinishedAt) refreshes.push(refreshUserState());
        if (newPhase !== prevPhase) {
          refreshes.push(refreshBuiltinAgent(BUILTIN_AGENT_SLUGS.webOnboarding));
        }
        if (refreshes.length > 0) await Promise.all(refreshes);
      },
    };
  }, [
    onboardingFinished,
    viewingHistoricalTopic,
    effectiveTopicId,
    data?.context?.phase,
    agentOnboarding?.finishedAt,
    refreshBuiltinAgent,
    refreshUserState,
    syncOnboardingContext,
    trackAgentOnboardingCompletion,
  ]);

  const conversationHooks = useMemo(() => {
    if (onboardingFinished) return undefined;
    return mergeConversationHooks(
      { onBeforeSendMessage: composedOnBeforeSendMessage },
      onboardingTurnSettledHook,
      onboardingFollowUpHooks,
    );
  }, [
    onboardingFinished,
    composedOnBeforeSendMessage,
    onboardingTurnSettledHook,
    onboardingFollowUpHooks,
  ]);

  if (error) {
    return (
      <OnboardingContainer>
        <RedirectToClassicOnboarding />
      </OnboardingContainer>
    );
  }

  // The builtin agent's slug must resolve before the page renders anything
  // useful. This is a short, in-process hydration (the builtin agent table is
  // usually warm); during this brief window we still show the brand loader.
  // Once `onboardingAgentId` is present, render the static Welcome shell
  // immediately — the bootstrap query keeps loading the rest in the background
  // while ChatInput is gated via `isInputReady`.
  if (!onboardingAgentId) {
    return <Loading debugId="AgentOnboarding" />;
  }

  const isInputReady = !isLoading;

  const handleReset = async () => {
    setIsResetting(true);

    try {
      await resetAgentOnboarding();
      const nextContext = await syncOnboardingContext();
      setSelectedTopicId(nextContext.topicId ?? undefined);
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <OnboardingContainer>
      <AnalyticsBridge />
      <Flexbox height={'100%'} width={'100%'}>
        <OnboardingConversationProvider
          agentId={onboardingAgentId}
          frozen={onboardingFinished}
          hooks={conversationHooks}
          topicId={effectiveTopicId}
        >
          <ErrorBoundary fallbackRender={() => null}>
            <AgentOnboardingConversation
              discoveryUserMessageCount={data?.context?.discoveryUserMessageCount}
              feedbackSubmitted={!!data?.feedbackSubmitted}
              finishTargetUrl={finishTargetUrl}
              hasMessages={hasMessages}
              isInputReady={isInputReady}
              onboardingFinished={onboardingFinished}
              phase={data?.context?.phase}
              readOnly={viewingHistoricalTopic}
              showFeedback={!viewingHistoricalTopic}
              topicId={effectiveTopicId}
              onAfterWrapUp={handleAfterWrapUp}
            />
          </ErrorBoundary>
        </OnboardingConversationProvider>
        {isDev && historyTopics.length > 0 && (
          <Drawer
            open={historyDrawerOpen}
            title={t('agent.history.title')}
            onClose={() => setHistoryDrawerOpen(false)}
          >
            <HistoryPanel
              activeTopicId={activeTopicId}
              selectedTopicId={effectiveTopicId}
              topics={historyTopics}
              onSelectTopic={(id) => {
                setSelectedTopicId(id);
                setHistoryDrawerOpen(false);
              }}
            />
          </Drawer>
        )}
      </Flexbox>
      {isDev && (
        <ModeSwitch
          actions={
            <>
              <AgentOnboardingDebugExportButton
                agentId={onboardingAgentId}
                topicId={effectiveTopicId}
              />
              {historyTopics.length > 0 && (
                <Button
                  icon={<History size={14} />}
                  size={'small'}
                  onClick={() => setHistoryDrawerOpen(true)}
                >
                  {t('agent.history.title')}
                </Button>
              )}
              <Button danger loading={isResetting} size={'small'} onClick={handleReset}>
                {t('agent.modeSwitch.reset')}
              </Button>
            </>
          }
        />
      )}
    </OnboardingContainer>
  );
});

AgentOnboardingPage.displayName = 'AgentOnboardingPage';

export default AgentOnboardingPage;

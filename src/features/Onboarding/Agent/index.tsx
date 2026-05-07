'use client';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { setAgentTemplatesFetcher } from '@lobechat/builtin-tool-agent-marketplace';
import { SESSION_CHAT_TOPIC_URL } from '@lobechat/const';
import { Button, ErrorBoundary, Flexbox } from '@lobehub/ui';
import { Drawer } from 'antd';
import { History } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import ModeSwitch from '@/features/Onboarding/components/ModeSwitch';
import { useClientDataSWR, useOnlyFetchOnceSWR } from '@/libs/swr';
import OnboardingContainer from '@/routes/onboarding/_layout';
import { fetchOnboardingAgentTemplates } from '@/services/agentMarketplace';
import { topicService } from '@/services/topic';
import { userService } from '@/services/user';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useUserStore } from '@/store/user';
import { isDev } from '@/utils/env';

import AnalyticsBridge from './AnalyticsBridge';
import { resolveAgentOnboardingContext } from './context';
import AgentOnboardingConversation from './Conversation';
import AgentOnboardingDebugExportButton from './DebugExportButton';
import HistoryPanel from './HistoryPanel';
import OnboardingConversationProvider from './OnboardingConversationProvider';
import { useOnboardingFollowUp } from './useOnboardingFollowUp';

const CLASSIC_ONBOARDING_PATH = '/onboarding/classic';

const RedirectToClassicOnboarding = memo(() => {
  const navigate = useNavigate();

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
    isDev && onboardingAgentId ? ['agent-onboarding-history-topics', onboardingAgentId] : null,
    () =>
      topicService.getTopics({
        agentId: onboardingAgentId,
        pageSize: 100,
      }),
  );

  const { data, error, isLoading, mutate } = useOnlyFetchOnceSWR(
    'agent-onboarding-bootstrap',
    () => userService.getOrCreateOnboardingState(),
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
  const activeTopicId = currentContext.topicId || data?.topicId;
  const historyTopics = historyData?.items || [];
  const effectiveTopicId = selectedTopicId || activeTopicId;
  const onboardingFinished = !!agentOnboarding?.finishedAt;
  const finishTargetUrl = useMemo(() => {
    if (!onboardingFinished || !inboxAgentId || !effectiveTopicId) return undefined;
    return SESSION_CHAT_TOPIC_URL(inboxAgentId, effectiveTopicId);
  }, [onboardingFinished, inboxAgentId, effectiveTopicId]);

  const viewingHistoricalTopic =
    !!activeTopicId && !!effectiveTopicId && effectiveTopicId !== activeTopicId;

  const onboardingChatKey = useMemo(
    () => messageMapKey({ agentId: onboardingAgentId || '', topicId: effectiveTopicId }),
    [onboardingAgentId, effectiveTopicId],
  );
  const messagesForOnboarding = useChatStore((s) => s.dbMessagesMap[onboardingChatKey]);
  const isGreeting = useMemo(() => {
    if (!messagesForOnboarding || messagesForOnboarding.length !== 1) return false;
    return messagesForOnboarding[0]?.role !== 'user';
  }, [messagesForOnboarding]);

  const onboardingFollowUp = useOnboardingFollowUp({
    enabled: !onboardingFinished && !viewingHistoricalTopic,
    isGreeting,
  });
  const { onBeforeSendMessage, triggerExtract } = onboardingFollowUp;

  const syncOnboardingContext = useCallback(async () => {
    const nextContext = await userService.getOrCreateOnboardingState();
    await mutate(nextContext, { revalidate: false });
    if (isDev && onboardingAgentId) await mutateHistoryTopics();

    return nextContext;
  }, [mutate, mutateHistoryTopics, onboardingAgentId]);

  const handleAssistantTurnSettled = useCallback(async () => {
    if (!effectiveTopicId) return;

    const prevPhase = data?.context?.phase;
    const prevFinishedAt = agentOnboarding?.finishedAt;

    const extractPromise = triggerExtract(effectiveTopicId, prevPhase);

    // Sync first to learn the next phase/finishedAt; only then decide whether
    // the heavier user-store / builtin-agent refreshes are needed this turn.
    const [nextContext] = await Promise.all([syncOnboardingContext(), extractPromise]);

    const newPhase = nextContext?.context?.phase;
    const newFinishedAt = nextContext?.agentOnboarding?.finishedAt;

    const refreshes: Promise<unknown>[] = [];
    if (newFinishedAt !== prevFinishedAt) refreshes.push(refreshUserState());
    if (newPhase !== prevPhase) {
      refreshes.push(refreshBuiltinAgent(BUILTIN_AGENT_SLUGS.webOnboarding));
    }
    if (refreshes.length > 0) await Promise.all(refreshes);
  }, [
    agentOnboarding?.finishedAt,
    data?.context?.phase,
    effectiveTopicId,
    refreshBuiltinAgent,
    refreshUserState,
    syncOnboardingContext,
    triggerExtract,
  ]);
  const assistantTurnSettledHandler =
    onboardingFinished || viewingHistoricalTopic ? undefined : handleAssistantTurnSettled;

  if (error) {
    return (
      <OnboardingContainer>
        <RedirectToClassicOnboarding />
      </OnboardingContainer>
    );
  }

  if (isLoading || !activeTopicId || !onboardingAgentId || !effectiveTopicId) {
    return <Loading debugId="AgentOnboarding" />;
  }

  const handleReset = async () => {
    setIsResetting(true);

    try {
      await resetAgentOnboarding();
      const nextContext = await syncOnboardingContext();
      setSelectedTopicId(nextContext.topicId);
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
          topicId={effectiveTopicId}
          hooks={
            onboardingFinished
              ? undefined
              : {
                  onBeforeSendMessage,
                }
          }
        >
          <ErrorBoundary fallbackRender={() => null}>
            <AgentOnboardingConversation
              discoveryUserMessageCount={data?.context?.discoveryUserMessageCount}
              feedbackSubmitted={!!data?.feedbackSubmitted}
              finishTargetUrl={finishTargetUrl}
              onboardingFinished={onboardingFinished}
              phase={data?.context?.phase}
              readOnly={viewingHistoricalTopic}
              showFeedback={!viewingHistoricalTopic}
              topicId={effectiveTopicId}
              onAfterWrapUp={syncOnboardingContext}
              onAssistantTurnSettled={assistantTurnSettledHandler}
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
      <ModeSwitch
        actions={
          isDev ? (
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
          ) : undefined
        }
      />
    </OnboardingContainer>
  );
});

AgentOnboardingPage.displayName = 'AgentOnboardingPage';

export default AgentOnboardingPage;

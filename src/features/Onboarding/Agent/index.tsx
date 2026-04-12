'use client';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { SESSION_CHAT_URL } from '@lobechat/const';
import { Button, ErrorBoundary, Flexbox } from '@lobehub/ui';
import { Drawer } from 'antd';
import { History } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import ModeSwitch from '@/features/Onboarding/components/ModeSwitch';
import { useClientDataSWR, useOnlyFetchOnceSWR } from '@/libs/swr';
import OnboardingContainer from '@/routes/onboarding/_layout';
import { topicService } from '@/services/topic';
import { userService } from '@/services/user';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { isDev } from '@/utils/env';

import { resolveAgentOnboardingContext } from './context';
import AgentOnboardingConversation from './Conversation';
import AgentOnboardingDebugExportButton from './DebugExportButton';
import HistoryPanel from './HistoryPanel';
import OnboardingConversationProvider from './OnboardingConversationProvider';

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
    return `${SESSION_CHAT_URL(inboxAgentId)}?topic=${effectiveTopicId}`;
  }, [onboardingFinished, inboxAgentId, effectiveTopicId]);

  const viewingHistoricalTopic =
    !!activeTopicId && !!effectiveTopicId && effectiveTopicId !== activeTopicId;

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

  const syncOnboardingContext = async () => {
    const nextContext = await userService.getOrCreateOnboardingState();
    await mutate(nextContext, { revalidate: false });
    if (isDev && onboardingAgentId) await mutateHistoryTopics();

    return nextContext;
  };

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
      <Flexbox height={'100%'} width={'100%'}>
        <OnboardingConversationProvider
          agentId={onboardingAgentId}
          frozen={onboardingFinished}
          topicId={effectiveTopicId}
          hooks={
            onboardingFinished
              ? undefined
              : {
                  onAfterSendMessage: async () => {
                    await syncOnboardingContext();
                    await Promise.all([
                      refreshUserState(),
                      refreshBuiltinAgent(BUILTIN_AGENT_SLUGS.webOnboarding),
                    ]);
                  },
                }
          }
        >
          <ErrorBoundary fallbackRender={() => null}>
            <AgentOnboardingConversation
              finishTargetUrl={finishTargetUrl}
              onboardingFinished={onboardingFinished}
              readOnly={viewingHistoricalTopic}
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

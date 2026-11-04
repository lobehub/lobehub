'use client';

import { AGENT_CHAT_URL } from '@lobechat/const';
import { Button, Flexbox, Text } from '@lobehub/ui';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { queueDraftForMainComposer } from '@/features/Conversation/composerDraftBus';
import { TaskTemplateCard } from '@/features/RecommendTaskTemplates/TaskTemplateCard';
import { TaskTemplateCardSkeleton } from '@/features/RecommendTaskTemplates/TaskTemplateCardSkeleton';
import { useDailyBriefRecommendationsUI } from '@/features/RecommendTaskTemplates/useDailyBriefRecommendationsUI';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import {
  trackOnboardingStepCompleted,
  trackOnboardingStepViewed,
} from '@/services/onboardingMetrics';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import LobeMessage from '../../components/LobeMessage';
import { styles } from '../AgentPickerStep/style';
import { buildKickoffPrompt } from './buildKickoffPrompt';

const STEP_TRACKING = { flow: 'classic', step: 'taskkickoff', stepIndex: 5 } as const;

type KickoffAction = 'chat_started' | 'skipped' | 'template_created';

/**
 * Closing hand-off of the classic onboarding, shown after it is finished:
 * create a first task from a suggested template, or open a chat with an
 * opening prompt built from the user's interests. "Start a chat" and "Skip"
 * stay available whatever the suggestions do (loading, failed, empty).
 */
const TaskKickoffStep = memo(() => {
  const { i18n, t } = useTranslation('onboarding');
  const navigate = useWorkspaceAwareNavigate();
  const interests = useUserStore(userProfileSelectors.interests);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const recommendations = useDailyBriefRecommendationsUI();

  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    trackOnboardingStepViewed(STEP_TRACKING);
  }, []);

  // Only the first action is tracked; the buttons keep working after it, so a
  // created task that did not navigate away never leaves the step stuck.
  const completedRef = useRef(false);
  const complete = useCallback((action: KickoffAction, extra?: Record<string, unknown>) => {
    if (completedRef.current) return;
    completedRef.current = true;
    trackOnboardingStepCompleted({
      ...STEP_TRACKING,
      ...extra,
      action,
      ...(action === 'skipped' && { skipped: true }),
    });
  }, []);

  const onRecommendationCreated =
    recommendations.mode === 'cards' ? recommendations.onCreated : undefined;
  // useTaskTemplateCreate navigates to the new task right after this runs.
  const handleCreated = useCallback(
    (templateId: number) => {
      complete('template_created', { templateId });
      onRecommendationCreated?.(templateId);
    },
    [complete, onRecommendationCreated],
  );

  const handleStartChat = useCallback(() => {
    complete('chat_started');
    if (!inboxAgentId) {
      navigate('/', { replace: true });
      return;
    }
    queueDraftForMainComposer(
      buildKickoffPrompt(interests, t, i18n.resolvedLanguage || i18n.language),
      { agentId: inboxAgentId },
    );
    navigate(AGENT_CHAT_URL(inboxAgentId), { replace: true });
  }, [complete, i18n.language, i18n.resolvedLanguage, inboxAgentId, interests, navigate, t]);

  const handleSkip = useCallback(() => {
    complete('skipped');
    navigate('/', { replace: true });
  }, [complete, navigate]);

  const renderSuggestions = () => {
    if (recommendations.mode === 'skeleton') {
      return Array.from({ length: recommendations.skeletonCount }, (_, index) => (
        <TaskTemplateCardSkeleton key={`task-kickoff-skeleton-${index}`} />
      ));
    }
    if (recommendations.mode === 'cards') {
      return recommendations.templates.map((tmpl) => (
        <TaskTemplateCard clickToCreate key={tmpl.id} template={tmpl} onCreated={handleCreated} />
      ));
    }
    return <div className={styles.empty}>{t('taskKickoff.empty')}</div>;
  };

  return (
    <Flexbox gap={16}>
      <LobeMessage sentences={[t('taskKickoff.title'), t('taskKickoff.title2')]} />
      <Text fontSize={14} type={'secondary'}>
        {t('taskKickoff.subtitle')}
      </Text>

      <Flexbox gap={8}>{renderSuggestions()}</Flexbox>

      <div className={styles.footer}>
        <span />
        <div className={styles.footerActions}>
          <Button type={'text'} onClick={handleSkip}>
            {t('taskKickoff.skip')}
          </Button>
          <Button type={'primary'} onClick={handleStartChat}>
            {t('taskKickoff.startChat')}
          </Button>
        </div>
      </div>
    </Flexbox>
  );
});

TaskKickoffStep.displayName = 'TaskKickoffStep';

export default TaskKickoffStep;

import { AGENT_CHAT_URL } from '@lobechat/const';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { queueDraftForMainComposer } from '@/features/Conversation/composerDraftBus';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import {
  trackOnboardingStepCompleted,
  trackOnboardingStepViewed,
} from '@/services/onboardingMetrics';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { buildKickoffPrompt } from './buildKickoffPrompt';

const STEP_TRACKING = { flow: 'classic', step: 'taskkickoff', stepIndex: 5 } as const;

type KickoffAction = 'chat_started' | 'skipped' | 'template_created';

interface UseTaskKickoffActionsOptions {
  /** Recommendation-side bookkeeping for a created template (rail dedupe). */
  onRecommendationCreated?: (templateId: number) => void;
}

export interface TaskKickoffActions {
  /** False until the inbox agent has loaded; "Start a chat" waits for it. */
  canStartChat: boolean;
  handleCreated: (templateId: number) => void;
  handleSkip: () => void;
  handleStartChat: () => void;
}

/**
 * Tracking and exits of the classic onboarding's closing hand-off. Only the
 * first exit is tracked; the actions keep working after it, so a created task
 * that did not navigate away never leaves the step stuck.
 */
export const useTaskKickoffActions = ({
  onRecommendationCreated,
}: UseTaskKickoffActionsOptions = {}): TaskKickoffActions => {
  const { i18n, t } = useTranslation('onboarding');
  const navigate = useWorkspaceAwareNavigate();
  const interests = useUserStore(userProfileSelectors.interests);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);

  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    trackOnboardingStepViewed(STEP_TRACKING);
  }, []);

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

  // useTaskTemplateCreate navigates to the new task right after this runs.
  const handleCreated = useCallback(
    (templateId: number) => {
      complete('template_created', { templateId });
      onRecommendationCreated?.(templateId);
    },
    [complete, onRecommendationCreated],
  );

  // The inbox agent loads with the app stores. Until it exists nothing happens
  // (Skip stays available), so a chat start is never tracked for a user who was
  // actually sent home.
  const handleStartChat = useCallback(() => {
    if (!inboxAgentId) return;
    complete('chat_started');
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

  return { canStartChat: !!inboxAgentId, handleCreated, handleSkip, handleStartChat };
};

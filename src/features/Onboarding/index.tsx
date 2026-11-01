'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import ClassicOnboardingPage from '@/features/Onboarding/Classic';
import OnboardingContainer from '@/features/Onboarding/Layout';
import ResponseLanguageStep from '@/features/Onboarding/steps/ResponseLanguageStep';
import TelemetryStep from '@/features/Onboarding/steps/TelemetryStep';
import { useOnboardingAgentTemplates } from '@/hooks/useOnboardingAgentTemplates';
import { useSingleton } from '@/hooks/useSingleton';
import {
  trackOnboardingStepCompleted,
  trackOnboardingStepViewed,
} from '@/services/onboardingMetrics';
import { useUserStore } from '@/store/user';
import { onboardingSelectors } from '@/store/user/selectors';
import { clearStaleOnboardingCallbackUrl } from '@/utils/onboardingRedirect';

const COMMON_STEP_TRACKING = {
  1: { flow: 'common', step: 'telemetry', stepIndex: 1 },
  2: { flow: 'common', step: 'response_language', stepIndex: 2 },
} as const;

const OnboardingPage = memo(() => {
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const commonStepsCompleted = useUserStore(onboardingSelectors.commonStepsCompleted);

  const [searchParams, setSearchParams] = useSearchParams();
  const step: 1 | 2 = searchParams.get('step') === '2' ? 2 : 1;
  const hasStepParam = searchParams.has('step');
  const viewedStepKeys = useSingleton(() => new Set<string>());

  useOnboardingAgentTemplates(isUserStateInit && (!commonStepsCompleted || hasStepParam));

  // This component only mounts on top-level entries to `/onboarding` (fresh
  // signup landings and `?step` re-entries from the classic back button), so
  // mount is the one safe point to drop a stale callback stashed by a
  // previously abandoned attempt — later search changes are internal step
  // navigations that must keep the stash.
  useEffect(() => {
    clearStaleOnboardingCallbackUrl(window.location.pathname, window.location.search);
  }, []);

  useEffect(() => {
    if (!isUserStateInit || (commonStepsCompleted && !hasStepParam)) return;

    const payload = COMMON_STEP_TRACKING[step];
    if (viewedStepKeys.has(payload.step)) return;

    viewedStepKeys.add(payload.step);
    trackOnboardingStepViewed(payload);
  }, [commonStepsCompleted, hasStepParam, isUserStateInit, step, viewedStepKeys]);

  const goNextFromTelemetry = useCallback(() => {
    trackOnboardingStepCompleted(COMMON_STEP_TRACKING[1]);
    setSearchParams({ step: '2' }, { replace: true });
  }, [setSearchParams]);

  const goBackFromLanguage = useCallback(() => {
    setSearchParams({ step: '1' }, { replace: true });
  }, [setSearchParams]);

  const finishCommon = useCallback(() => {
    trackOnboardingStepCompleted(COMMON_STEP_TRACKING[2]);
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  if (!isUserStateInit) {
    return <Loading debugId="Onboarding/userState" />;
  }

  // With the shared prefix complete, `/onboarding` renders the classic branch
  // inline — but an explicit `?step` (classic FullName back button) re-enters
  // the prefix.
  if (commonStepsCompleted && !hasStepParam) {
    return <ClassicOnboardingPage />;
  }

  return (
    <OnboardingContainer>
      <Flexbox gap={24} style={{ maxWidth: 600, width: '100%' }}>
        {step === 1 ? (
          <TelemetryStep onNext={goNextFromTelemetry} />
        ) : (
          <ResponseLanguageStep onBack={goBackFromLanguage} onNext={finishCommon} />
        )}
      </Flexbox>
    </OnboardingContainer>
  );
});

OnboardingPage.displayName = 'OnboardingPage';

export default OnboardingPage;

'use client';

import { isDesktop } from '@lobechat/const';
import { MAX_ONBOARDING_STEPS } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useEffect, useRef } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import { useOnboardingAgentTemplates } from '@/hooks/useOnboardingAgentTemplates';
import OnboardingContainer from '@/routes/onboarding/_layout';
import { deriveOnboardingBranchPath } from '@/routes/onboarding/branch';
import ResponseLanguageStep from '@/routes/onboarding/features/ResponseLanguageStep';
import TelemetryStep from '@/routes/onboarding/features/TelemetryStep';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { onboardingSelectors } from '@/store/user/selectors';

/**
 * Remap a `currentStep` persisted under the old 5-step classic flow
 * (1=Telemetry, 2=FullName, 3=Interests, 4=Language, 5=ProSettings) onto
 * the current classic flow (1=FullName, 2=Interests, 3=ProSettings,
 * 4=AgentPicker).
 *
 * Telemetry/Language are extracted into the shared prefix, so an in-progress
 * legacy user must skip those positions when resuming classic. Legacy
 * Language/ProSettings (raw >= 4) resume at the new ProSettings step
 * (MAX_ONBOARDING_STEPS - 1) — never the trailing agent-picker step.
 */
const remapLegacyClassicStep = (raw: number): number => {
  if (raw <= 2) return 1;
  if (raw === 3) return 2;
  return MAX_ONBOARDING_STEPS - 1;
};

const CommonOnboardingPage = memo(() => {
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const commonStepsCompleted = useUserStore(onboardingSelectors.commonStepsCompleted);
  const enableAgentOnboarding = useServerConfigStore((s) => s.featureFlags.enableAgentOnboarding);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);

  const [searchParams, setSearchParams] = useSearchParams();
  const step: 1 | 2 = searchParams.get('step') === '2' ? 2 : 1;
  const hasStepParam = searchParams.has('step');

  useOnboardingAgentTemplates(isUserStateInit && (!commonStepsCompleted || hasStepParam));

  // One-time legacy migration: when the user lands on the shared prefix, if
  // their persisted `currentStep` was authored under the old 5-step schema,
  // remap it onto the new 3-step schema before classic ever mounts. Gated by
  // `isUserStateInit` so we don't act on an empty initial slice. Skips when
  // onboarding is already finished or unset — mid-flow legacy users only.
  const remappedRef = useRef(false);
  useEffect(() => {
    if (!isUserStateInit || remappedRef.current) return;
    const state = useUserStore.getState();
    const persisted = state.onboarding?.currentStep;
    if (persisted === undefined || state.onboarding?.finishedAt) {
      remappedRef.current = true;
      return;
    }
    const remapped = remapLegacyClassicStep(persisted);
    if (remapped !== persisted) {
      void state.setOnboardingStep(remapped);
    }
    remappedRef.current = true;
  }, [isUserStateInit]);

  useEffect(() => {
    if (__TEST__) return;
    void import('@/routes/onboarding/agent');
    void import('@/routes/onboarding/classic');
  }, []);

  const goNextFromTelemetry = useCallback(() => {
    setSearchParams({ step: '2' }, { replace: true });
  }, [setSearchParams]);

  const goBackFromLanguage = useCallback(() => {
    setSearchParams({ step: '1' }, { replace: true });
  }, [setSearchParams]);

  const finishCommon = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  if (!isUserStateInit) {
    return <Loading debugId="CommonOnboarding/userState" />;
  }

  // With the prefix complete, a bare `/onboarding` resumes the branch — but an
  // explicit `?step` (FullNameStep's back button) re-enters the shared prefix.
  if (commonStepsCompleted && !hasStepParam) {
    if (!serverConfigInit) {
      return <Loading debugId="CommonOnboarding/serverConfig" />;
    }
    const branchPath = deriveOnboardingBranchPath({
      enableAgentOnboarding: !!enableAgentOnboarding,
      isDesktop,
    });
    return <Navigate replace to={branchPath} />;
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

CommonOnboardingPage.displayName = 'CommonOnboardingPage';

export default CommonOnboardingPage;

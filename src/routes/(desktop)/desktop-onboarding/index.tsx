'use client';

import { APP_WINDOW_MIN_SIZE } from '@lobechat/desktop-bridge';
import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo, Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import { remoteServerService } from '@/services/electron/remoteServer';
import { electronSystemService } from '@/services/electron/system';

import OnboardingContainer from './_layout';
import DataModeStep from './features/DataModeStep';
import LoginStep from './features/LoginStep';
import PermissionsStep from './features/PermissionsStep';
import WelcomeStep from './features/WelcomeStep';
import { resolveNextScreen, resolvePreviousScreen } from './flow';
import { resolveInitialScreen } from './resolveInitialScreen';
import {
  clearDesktopOnboardingScreen,
  getDesktopOnboardingEverCompleted,
  getDesktopOnboardingScreen,
  setDesktopOnboardingCompleted,
  setDesktopOnboardingEverCompleted,
  setDesktopOnboardingScreen,
} from './storage';
import { DesktopOnboardingScreen, isDesktopOnboardingScreen } from './types';

const DesktopOnboardingPage = memo(() => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isMac, setIsMac] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [everCompleted] = useState(getDesktopOnboardingEverCompleted);

  const resolveScreenForPlatform = useCallback(
    (screen: DesktopOnboardingScreen) =>
      resolveInitialScreen({
        everCompleted,
        isMac,
        requested: screen,
        saved: null,
      }),
    [everCompleted, isMac],
  );

  const getRequestedScreenFromUrl = useCallback((): DesktopOnboardingScreen | null => {
    const screenParam = searchParams.get('screen');
    if (isDesktopOnboardingScreen(screenParam)) return screenParam;

    return null;
  }, [searchParams]);

  const [currentScreen, setCurrentScreen] = useState<DesktopOnboardingScreen>(
    DesktopOnboardingScreen.Welcome,
  );

  useEffect(() => {
    electronSystemService.setDesktopOnboardingCompleted(false).catch((error) => {
      console.error('[DesktopOnboarding] Failed to mark onboarding as in progress:', error);
    });
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const initial = resolveInitialScreen({
      everCompleted,
      isMac,
      requested: getRequestedScreenFromUrl(),
      saved: getDesktopOnboardingScreen(),
    });

    setCurrentScreen(initial);

    // Canonicalize URL to `?screen=...`
    const currentUrlScreen = searchParams.get('screen');
    if (currentUrlScreen !== initial) {
      setSearchParams({ screen: initial });
    }
  }, [everCompleted, getRequestedScreenFromUrl, isLoading, isMac, searchParams, setSearchParams]);

  // Persist current screen to localStorage.
  useEffect(() => {
    if (isLoading) return;
    setDesktopOnboardingScreen(currentScreen);
  }, [currentScreen, isLoading]);

  // Set window size and resizability
  useEffect(() => {
    const minimumSize = { height: 900, width: 1200 };

    const applyWindowSettings = async () => {
      try {
        await electronSystemService.setWindowMinimumSize(minimumSize);
      } catch (error) {
        console.error('[DesktopOnboarding] Failed to apply window settings:', error);
      }
    };

    applyWindowSettings();

    return () => {
      // Restore to app-level default minimum size preset
      electronSystemService.setWindowMinimumSize(APP_WINDOW_MIN_SIZE).catch((error) => {
        console.error('[DesktopOnboarding] Failed to restore window settings:', error);
      });
    };
  }, []);

  // Detect platform: skip permissions page on non-macOS
  useEffect(() => {
    let mounted = true;
    const detectPlatform = async () => {
      try {
        const state = await electronSystemService.getAppState();
        if (!mounted) return;
        setIsMac(state.platform === 'darwin');
      } catch {
        // Fallback: keep default (true)
      } finally {
        setIsLoading(false);
      }
    };
    void detectPlatform();
    return () => {
      mounted = false;
    };
  }, []);

  // Listen URL changes: allow deep-linking between screens.
  useEffect(() => {
    if (isLoading) return;
    const requested = getRequestedScreenFromUrl();
    if (!requested) return;
    const resolved = resolveScreenForPlatform(requested);
    if (resolved !== currentScreen) setCurrentScreen(resolved);
  }, [currentScreen, getRequestedScreenFromUrl, isLoading, resolveScreenForPlatform]);

  const completeOnboarding = useCallback(async () => {
    setDesktopOnboardingCompleted();
    setDesktopOnboardingEverCompleted();
    clearDesktopOnboardingScreen();

    try {
      await Promise.all([
        electronSystemService.setDesktopOnboardingCompleted(true),
        electronSystemService.setWindowMinimumSize(APP_WINDOW_MIN_SIZE),
      ]);
    } catch (error) {
      console.error('[DesktopOnboarding] Failed to finalize onboarding:', error);
    }

    // Use hard reload instead of SPA navigation to ensure the app boots with the new desktop state.
    window.location.replace('/');
  }, []);

  const goToNextStep = useCallback(async () => {
    let isAuthenticated = false;
    try {
      isAuthenticated = await remoteServerService.isRemoteServerConfigured();
    } catch (error) {
      console.error('[DesktopOnboarding] Failed to verify authentication:', error);
    }

    const next = resolveNextScreen({
      current: currentScreen,
      everCompleted,
      isAuthenticated,
      isMac,
    });

    if (!next) {
      await completeOnboarding();
      return;
    }

    setSearchParams({ screen: next });
    setCurrentScreen(next);
  }, [completeOnboarding, currentScreen, everCompleted, isMac, setSearchParams]);

  const goToPreviousStep = useCallback(() => {
    setCurrentScreen((prev) => {
      const prevScreen = resolvePreviousScreen({ current: prev, isMac });
      setSearchParams({ screen: prevScreen });
      return prevScreen;
    });
  }, [isMac, setSearchParams]);

  if (isLoading) {
    return <Loading debugId="DesktopOnboarding" />;
  }

  const renderStep = () => {
    switch (currentScreen) {
      case DesktopOnboardingScreen.Welcome: {
        return <WelcomeStep onNext={goToNextStep} />;
      }
      case DesktopOnboardingScreen.Permissions: {
        // macOS-only screen; fallback to DataMode if platform doesn't support.
        if (!isMac) {
          setCurrentScreen(DesktopOnboardingScreen.DataMode);
          return null;
        }
        return <PermissionsStep onBack={goToPreviousStep} onNext={goToNextStep} />;
      }
      case DesktopOnboardingScreen.DataMode: {
        return <DataModeStep onBack={goToPreviousStep} onNext={goToNextStep} />;
      }
      case DesktopOnboardingScreen.Login: {
        return <LoginStep onBack={goToPreviousStep} onNext={goToNextStep} />;
      }
      default: {
        return null;
      }
    }
  };

  return (
    <OnboardingContainer>
      <Flexbox gap={24} style={{ maxWidth: 560, minHeight: '100%', width: '100%' }}>
        <Suspense
          fallback={
            <Flexbox gap={8}>
              <Skeleton.Avatar size={48} />
              <Skeleton
                paragraph={{
                  rows: 8,
                }}
                title={{
                  fontSize: 24,
                }}
              />
            </Flexbox>
          }
        >
          {renderStep()}
        </Suspense>
      </Flexbox>
    </OnboardingContainer>
  );
});

DesktopOnboardingPage.displayName = 'DesktopOnboardingPage';

export default DesktopOnboardingPage;

'use client';

import { APP_WINDOW_MIN_SIZE } from '@lobechat/desktop-bridge';
import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo, Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import { electronSystemService } from '@/services/electron/system';

import OnboardingContainer from './_layout';
import DataModeStep from './features/DataModeStep';
import LoginStep from './features/LoginStep';
import PermissionsStep from './features/PermissionsStep';
import WelcomeStep from './features/WelcomeStep';
import {
  clearDesktopOnboardingScreen,
  getDesktopOnboardingScreen,
  setDesktopOnboardingCompleted,
  setDesktopOnboardingScreen,
} from './storage';
import { DesktopOnboardingScreen, isDesktopOnboardingScreen } from './types';

const DesktopOnboardingPage = memo(() => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isMac, setIsMac] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  const flow = isMac
    ? [
        DesktopOnboardingScreen.Welcome,
        DesktopOnboardingScreen.Permissions,
        DesktopOnboardingScreen.DataMode,
        DesktopOnboardingScreen.Login,
      ]
    : [
        DesktopOnboardingScreen.Welcome,
        DesktopOnboardingScreen.DataMode,
        DesktopOnboardingScreen.Login,
      ];

  const resolveScreenForPlatform = useCallback(
    (screen: DesktopOnboardingScreen) => {
      if (!isMac && screen === DesktopOnboardingScreen.Permissions)
        return DesktopOnboardingScreen.DataMode;
      return screen;
    },
    [isMac],
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
    if (isLoading) return;

    const saved = getDesktopOnboardingScreen();
    const requested = getRequestedScreenFromUrl();

    const initial = resolveScreenForPlatform(requested ?? saved ?? DesktopOnboardingScreen.Welcome);

    setCurrentScreen(initial);

    // Canonicalize URL to `?screen=...`
    const currentUrlScreen = searchParams.get('screen');
    if (currentUrlScreen !== initial) {
      setSearchParams({ screen: initial });
    }
  }, [
    getRequestedScreenFromUrl,
    isLoading,
    resolveScreenForPlatform,
    searchParams,
    setSearchParams,
  ]);

  // Persist current screen to localStorage.
  useEffect(() => {
    if (isLoading) return;
    setDesktopOnboardingScreen(currentScreen);
  }, [currentScreen, isLoading]);

  // 设置窗口大小和可调整性
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

  // 检测平台：非 macOS 直接跳过权限页
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

  const goToNextStep = useCallback(() => {
    setCurrentScreen((prev) => {
      const idx = flow.indexOf(prev);
      const next = flow[idx + 1];

      if (!next) {
        // Complete onboarding.
        setDesktopOnboardingCompleted();
        clearDesktopOnboardingScreen();

        // Restore window minimum size before hard reload (cleanup won't run due to hard navigation)
        electronSystemService
          .setWindowMinimumSize(APP_WINDOW_MIN_SIZE)
          .catch(console.error)
          .finally(() => {
            // Use hard reload instead of SPA navigation to ensure the app boots with the new desktop state.
            window.location.replace('/');
          });

        return prev;
      }

      setSearchParams({ screen: next });
      return next;
    });
  }, [isMac, setSearchParams]);

  const goToPreviousStep = useCallback(() => {
    setCurrentScreen((prev) => {
      const idx = flow.indexOf(prev);
      const prevScreen = flow[Math.max(0, idx - 1)] ?? DesktopOnboardingScreen.Welcome;
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

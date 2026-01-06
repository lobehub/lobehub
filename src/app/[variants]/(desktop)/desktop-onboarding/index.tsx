'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { Suspense, memo, useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import { electronSystemService } from '@/services/electron/system';
import { isDev } from '@/utils/env';

import OnboardingContainer from './_layout';
import DataModeStep from './features/DataModeStep';
import LoginStep from './features/LoginStep';
import PermissionsStep from './features/PermissionsStep';
import WelcomeStep from './features/WelcomeStep';
import { getDesktopOnboardingCompleted, setDesktopOnboardingCompleted } from './storage';

const DesktopOnboardingPage = memo(() => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isMac, setIsMac] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  // 从 URL query 参数获取初始步骤，默认为 1
  const getInitialStep = useCallback(() => {
    const stepParam = searchParams.get('step');
    if (stepParam) {
      const step = parseInt(stepParam, 10);
      if (step >= 1 && step <= 4) return step;
    }
    return 1;
  }, [searchParams]);

  const [currentStep, setCurrentStep] = useState(getInitialStep);

  // 检查是否已完成 onboarding
  useEffect(() => {
    if (isDev) return;
    if (getDesktopOnboardingCompleted()) navigate('/', { replace: true });
  }, [navigate]);

  // 设置窗口大小和可调整性
  useEffect(() => {
    const fixedSize = { height: 900, width: 1400 };

    const applyWindowSettings = async () => {
      try {
        await electronSystemService.setWindowSize(fixedSize);
        await electronSystemService.setWindowResizable({ resizable: false });
      } catch (error) {
        console.error('[DesktopOnboarding] Failed to apply window settings:', error);
      }
    };

    applyWindowSettings();

    return () => {
      electronSystemService.setWindowResizable({ resizable: true }).catch((error) => {
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

  // 监听 URL query 参数变化
  useEffect(() => {
    const stepParam = searchParams.get('step');
    if (stepParam) {
      const step = parseInt(stepParam, 10);
      if (step >= 1 && step <= 4 && step !== currentStep) {
        setCurrentStep(step);
      }
    }
  }, [searchParams, currentStep]);

  const goToNextStep = useCallback(() => {
    setCurrentStep((prev) => {
      let nextStep: number;
      // 如果是第1步（WelcomeStep），下一步根据平台决定
      switch (prev) {
        case 1: {
          nextStep = isMac ? 2 : 3; // macOS 显示权限页，其他平台跳过

          break;
        }
        case 2: {
          // 如果是第2步（PermissionsStep，仅 macOS），下一步是第3步
          nextStep = 3;

          break;
        }
        case 3: {
          // 如果是第3步（DataModeStep），下一步是第4步
          nextStep = 4;

          break;
        }
        case 4: {
          // 如果是第4步（LoginStep），完成 onboarding
          setDesktopOnboardingCompleted();
          // Restore window resizable before hard reload (cleanup won't run due to hard navigation)
          electronSystemService
            .setWindowResizable({ resizable: true })
            .catch(console.error)
            .finally(() => {
              // Use hard reload instead of SPA navigation to ensure the app boots with the new desktop state.
              window.location.replace('/');
            });
          return prev;
        }
        default: {
          nextStep = prev + 1;
        }
      }
      // 更新 URL query 参数
      setSearchParams({ step: nextStep.toString() });
      return nextStep;
    });
  }, [isMac, setSearchParams]);

  const goToPreviousStep = useCallback(() => {
    setCurrentStep((prev) => {
      if (prev <= 1) return 1;
      let prevStep: number;
      // 如果当前是第3步（DataModeStep），上一步根据平台决定
      if (prev === 3) {
        prevStep = isMac ? 2 : 1;
      } else if (prev === 2) {
        // 如果当前是第2步（PermissionsStep），上一步是第1步
        prevStep = 1;
      } else {
        prevStep = prev - 1;
      }
      // 更新 URL query 参数
      setSearchParams({ step: prevStep.toString() });
      return prevStep;
    });
  }, [isMac, setSearchParams]);

  if (isLoading) {
    return <Loading debugId="DesktopOnboarding" />;
  }

  const renderStep = () => {
    switch (currentStep) {
      case 1: {
        return <WelcomeStep onNext={goToNextStep} />;
      }
      case 2: {
        // 仅 macOS 显示权限页
        if (!isMac) {
          return <DataModeStep onBack={goToPreviousStep} onNext={goToNextStep} />;
        }
        return <PermissionsStep onBack={goToPreviousStep} onNext={goToNextStep} />;
      }
      case 3: {
        return <DataModeStep onBack={goToPreviousStep} onNext={goToNextStep} />;
      }
      case 4: {
        return <LoginStep onBack={goToPreviousStep} onNext={goToNextStep} />;
      }
      default: {
        return null;
      }
    }
  };

  return (
    <OnboardingContainer>
      <Flexbox gap={24} style={{ maxWidth: 560, width: '100%' }}>
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

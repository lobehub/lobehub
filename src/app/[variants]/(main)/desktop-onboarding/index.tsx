'use client';

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { OnboardingContainerWithTheme } from '@/features/DesktopOnboarding/OnboardingContainer';
import {
  getDesktopOnboardingCompleted,
  setDesktopOnboardingCompleted,
} from '@/features/DesktopOnboarding/storage';
import { electronSystemService } from '@/services/electron/system';
import { isDev } from '@/utils/env';

const DesktopOnboarding = () => {
  const navigate = useNavigate();

  useEffect(() => {
    if (isDev) return;
    if (getDesktopOnboardingCompleted()) navigate('/', { replace: true });
  }, [navigate]);

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

  return (
    <OnboardingContainerWithTheme
      onComplete={() => {
        setDesktopOnboardingCompleted();
        // Use hard reload instead of SPA navigation to ensure the app boots with the new desktop state.
        window.location.replace('/');
      }}
    />
  );
};

export default DesktopOnboarding;

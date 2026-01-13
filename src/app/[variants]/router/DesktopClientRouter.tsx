'use client';

import { useEffect } from 'react';
import { BrowserRouter, Routes, useNavigate } from 'react-router-dom';

import { getDesktopOnboardingCompleted } from '@/app/[variants]/(desktop)/desktop-onboarding/storage';
import { isDesktop } from '@/const/version';
import { renderRoutes } from '@/utils/router';

import { desktopRoutes } from './desktopRouter.config';

const DesktopOnboardingRedirect = () => {
  const navigate = useNavigate();
  useEffect(() => {
    // Desktop runtime guard
    if (!isDesktop) return;

    // If already completed, allow normal routing.
    if (getDesktopOnboardingCompleted()) return;

    // Redirect to SPA onboarding route.
    if (window.location.pathname !== '/desktop-onboarding') {
      navigate('/desktop-onboarding', { replace: true });
    }
  }, []);

  return null;
};

const ClientRouter = () => {
  return (
    <BrowserRouter>
      <Routes>{renderRoutes(desktopRoutes)}</Routes>
      {isDesktop && <DesktopOnboardingRedirect />}
    </BrowserRouter>
  );
};

ClientRouter.displayName = 'ClientRouter';

export default ClientRouter;

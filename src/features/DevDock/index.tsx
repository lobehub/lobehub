'use client';

import { lazy, Suspense, useCallback, useState } from 'react';

import { registerBusinessDevDockItems } from '@/business/client/registerDevDockItems';
import FlagOverrideHydrator from '@/features/DevFeatureFlagPanel/Hydrator';

import Bar from './Bar';
import PanelHost from './PanelHost';
import ReactScanController from './ReactScanController';
import { registerBuiltinDevDockItems } from './registerBuiltinItems';
import { useDevDockStore } from './store';

const Mesurer = lazy(() => import('mesurer').then((module) => ({ default: module.Mesurer })));

const MesurerPortal = () => {
  const [portalTarget, setPortalTarget] = useState<ShadowRoot | null>(null);
  const setPortalHost = useCallback((host: HTMLDivElement | null) => {
    if (host) setPortalTarget(host.shadowRoot ?? host.attachShadow({ mode: 'open' }));
  }, []);

  return (
    <>
      <div ref={setPortalHost} />
      {portalTarget && (
        <Suspense fallback={null}>
          <Mesurer portalTarget={portalTarget} />
        </Suspense>
      )}
    </>
  );
};

registerBuiltinDevDockItems();
registerBusinessDevDockItems();

const DevDock = () => {
  const mesurer = useDevDockStore((state) => state.mesurer);

  return (
    <>
      <FlagOverrideHydrator />
      {mesurer && <MesurerPortal />}
      <ReactScanController />
      <PanelHost />
      <Bar />
    </>
  );
};

export default DevDock;

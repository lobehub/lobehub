'use client';

import { createContext, memo, use } from 'react';

import PortalMoreMenu from './index';
import { type UsePortalMoreMenu } from './types';

interface PortalMoreMenuSource {
  /** Remounts the hook host when the view changes, so hook order never mixes. */
  key: string;
  useMoreMenu: UsePortalMoreMenu;
}

const PortalMoreMenuContext = createContext<PortalMoreMenuSource | null>(null);

/** Set by the portal router around the active view's header. */
export const PortalMoreMenuProvider = PortalMoreMenuContext.Provider;

const MoreMenuHost = memo<{ useMoreMenu: UsePortalMoreMenu }>(({ useMoreMenu }) => {
  const config = useMoreMenu();

  return <PortalMoreMenu config={config} />;
});

MoreMenuHost.displayName = 'PortalMoreMenuHost';

/** Title-slot mount point in the shared header; empty for views with no menu. */
export const PortalMoreMenuSlot = memo(() => {
  const source = use(PortalMoreMenuContext);
  if (!source) return null;

  return <MoreMenuHost key={source.key} useMoreMenu={source.useMoreMenu} />;
});

PortalMoreMenuSlot.displayName = 'PortalMoreMenuSlot';

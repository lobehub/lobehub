'use client';

import { memo } from 'react';

import HomeNavPanelPortal from '@/features/HomeSidebar';

import NavPanel from './index';

// The Home portal is owned by the shell, not by the Home route layout: routes
// without a dedicated sidebar (for example /tasks, /agents) resolve to the
// `home` nav key, and on desktop `NavPanel` lives outside `TabHost` while the
// Home layout only mounts inside a home tab — and `Activity` unmounts effects
// for inactive tabs. Registering from the route layout leaves those tabs with
// no `home` entry at all, so the panel is stuck on the loading skeleton.
const NavPanelShell = memo(() => (
  <>
    <HomeNavPanelPortal />
    <NavPanel />
  </>
));

NavPanelShell.displayName = 'NavPanelShell';

export default NavPanelShell;

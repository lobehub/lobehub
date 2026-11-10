'use client';

import { memo } from 'react';

import MobileBackButton from './MobileBackButton';
import MobileNavPanelButton from './MobileNavPanelButton';

/**
 * What a page header shows on mobile where desktop shows the left panel
 * toggle: a back button, and the route's sidebar as a drawer when it has one.
 * Use it in custom page headers that do not go through `NavHeader`.
 */
const MobileHeaderNav = memo(() => (
  <>
    <MobileBackButton />
    <MobileNavPanelButton />
  </>
));

MobileHeaderNav.displayName = 'MobileHeaderNav';

export default MobileHeaderNav;

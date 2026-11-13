import { createContext, use } from 'react';

/**
 * Set while a route's sidebar is shown inside the mobile nav drawer
 * (`NavHeader/MobileNavPanelButton`). Sidebar controls that would collapse the
 * desktop left panel close the drawer instead.
 */
export const MobileNavDrawerContext = createContext<(() => void) | null>(null);

export const useCloseMobileNavDrawer = () => use(MobileNavDrawerContext);

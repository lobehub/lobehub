import { NAV_RAIL_ENABLED } from '@lobechat/business-const';
import { stripTenantPath } from '@lobechat/business-tenant/routing';
import { cssVar } from '@lobehub/ui';

import { isDesktop } from '@/const/version';
import { MAC_VIBRANCY_BACKGROUND } from '@/features/Electron/system/macWindowFullscreen';
import { readBootUrl, resolveBootAction } from '@/features/Electron/TabHost/resolveBootAction';
import { resolveTabScope } from '@/features/Electron/titlebar/TabBar/scope';
import { getTabPages } from '@/features/Electron/titlebar/TabBar/storage';
import { hidesNavPanel } from '@/features/NavPanel/hidesNavPanel';
import { NAV_RAIL_WIDTH } from '@/features/NavRail/constants';
import { useGlobalStore } from '@/store/global';
import { INITIAL_STATUS } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';
import { isMacOS } from '@/utils/platform';

export interface BootShellGeometry {
  isDark: boolean;
  navPanelBackground: string;
  navPanelWidth: number;
  /** Width the icon rail takes left of the panel; 0 when the rail is off. */
  navRailWidth: number;
  showLeftPanel: boolean;
}

const readIsDark = () => {
  try {
    return document.documentElement.dataset.theme === 'dark';
  } catch {
    return false;
  }
};

// Mirrors `NavPanelDraggable`'s panel background so the shell hands over to a
// panel of the same color instead of flashing an opaque block over vibrancy.
const readNavPanelBackground = () =>
  isDesktop && isMacOS() ? MAC_VIBRANCY_BACKGROUND : cssVar.colorBgLayout;

// Match the first desktop tab without mutating tab state before the host mounts.
const readBootLocation = () => {
  const { location } = window;
  if (!isDesktop) return location;

  const bootUrl = readBootUrl(location);
  const { activeTabId, tabs } = getTabPages(resolveTabScope(bootUrl));
  const action = resolveBootAction(tabs, activeTabId, bootUrl);
  const restoredTab = action.type === 'keep' && tabs.find((tab) => tab.id === activeTabId);
  return restoredTab ? new URL(restoredTab.url, location.origin) : location;
};

const readPanelHiddenByPage = () => {
  try {
    const { pathname, search } = readBootLocation();
    return hidesNavPanel(stripTenantPath(pathname), search);
  } catch {
    return false;
  }
};

export const readBootShellGeometry = (): BootShellGeometry => {
  const base = {
    isDark: readIsDark(),
    navPanelBackground: readNavPanelBackground(),
    navRailWidth: NAV_RAIL_ENABLED ? NAV_RAIL_WIDTH : 0,
  };
  const panelHiddenByPage = readPanelHiddenByPage();

  try {
    const state = useGlobalStore.getState();

    return {
      ...base,
      navPanelWidth: systemStatusSelectors.leftPanelWidth(state),
      showLeftPanel: Boolean(systemStatusSelectors.showLeftPanel(state)) && !panelHiddenByPage,
    };
  } catch {
    return {
      ...base,
      navPanelWidth: INITIAL_STATUS.leftPanelWidth,
      showLeftPanel: Boolean(INITIAL_STATUS.showLeftPanel) && !panelHiddenByPage,
    };
  }
};

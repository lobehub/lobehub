import { cssVar } from 'antd-style';

import { isDesktop } from '@/const/version';
import { useGlobalStore } from '@/store/global';
import { INITIAL_STATUS } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';
import { isMacOS } from '@/utils/platform';

export interface BootShellGeometry {
  isDark: boolean;
  navPanelBackground: string;
  navPanelWidth: number;
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
  isDesktop && isMacOS() ? 'transparent' : cssVar.colorBgLayout;

export const readBootShellGeometry = (): BootShellGeometry => {
  const base = {
    isDark: readIsDark(),
    navPanelBackground: readNavPanelBackground(),
  };

  try {
    const state = useGlobalStore.getState();

    return {
      ...base,
      navPanelWidth: systemStatusSelectors.leftPanelWidth(state),
      showLeftPanel: Boolean(systemStatusSelectors.showLeftPanel(state)),
    };
  } catch {
    return {
      ...base,
      navPanelWidth: INITIAL_STATUS.leftPanelWidth,
      showLeftPanel: Boolean(INITIAL_STATUS.showLeftPanel),
    };
  }
};

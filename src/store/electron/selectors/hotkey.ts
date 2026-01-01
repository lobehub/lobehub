import { DEFAULT_DESKTOP_HOTKEY_CONFIG } from '@/const/desktop';
import { type ElectronState } from '@/store/electron/initialState';
import { merge } from '@/utils/merge';

const hotkeys = (s: ElectronState) => merge(DEFAULT_DESKTOP_HOTKEY_CONFIG, s.desktopHotkeys);
const isHotkeysInit = (s: ElectronState) => s.isDesktopHotkeysInit;

export const desktopHotkeysSelectors = {
  hotkeys,
  isHotkeysInit,
};

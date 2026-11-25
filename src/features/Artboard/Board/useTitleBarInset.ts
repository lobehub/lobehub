import { isDesktop } from '@/const/version';
import { useMacTrafficLightPadding } from '@/features/Electron/titlebar/useMacTrafficLightPadding';

const useDesktopInset = () => useMacTrafficLightPadding();
const useNoInset = () => 0;

export const useTitleBarInset = isDesktop ? useDesktopInset : useNoInset;

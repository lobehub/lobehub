import type { GuidedPermission } from '@lobechat/electron-client-ipc';

export type { GuidedPermission } from '@lobechat/electron-client-ipc';

const PANE_ANCHORS: Record<GuidedPermission, string> = {
  accessibility: 'Privacy_Accessibility',
  fullDisk: 'Privacy_AllFiles',
  inputMonitoring: 'Privacy_ListenEvent',
  screen: 'Privacy_ScreenCapture',
};

// Measured from the System Settings accessibility tree; versions not listed
// here center the guide on the whole window rather than guess.
const SIDEBAR_WIDTH_BY_MAJOR: Record<number, number> = {
  27: 232,
};

export const getSettingsPaneUrl = (permission: GuidedPermission) =>
  `x-apple.systempreferences:com.apple.preference.security?${PANE_ANCHORS[permission]}`;

export const getSettingsSidebarWidth = (systemVersion: string) =>
  SIDEBAR_WIDTH_BY_MAJOR[Number(systemVersion.split('.')[0])] ?? 0;

export const getAppBundlePath = (executablePath: string) => {
  const index = executablePath.indexOf('.app/');
  return index === -1 ? undefined : executablePath.slice(0, index + 4);
};

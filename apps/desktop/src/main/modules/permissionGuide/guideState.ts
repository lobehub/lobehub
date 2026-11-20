import type { PermissionGuideState } from '@lobechat/electron-mac-permission-guide';

import type { GuidedPermission } from './settingsPanes';

export type GuidePhase =
  'confirming' | 'granted' | 'missing' | 'offPane' | 'relaunch' | 'retry' | 'waiting';

const BOTTOM_INSET = 20;
const MISSING_TIMEOUT_MS = 3000;

interface BuildGuideStateParams {
  appName: string;
  appPath: string;
  launchOrigin?: { x: number; y: number };
  permission: GuidedPermission;
  phase: GuidePhase;
  sidebarWidth: number;
  t: (key: string, options?: Record<string, string>) => string;
}

export const buildGuideState = ({
  appName,
  appPath,
  launchOrigin,
  permission,
  phase,
  sidebarWidth,
  t,
}: BuildGuideStateParams): PermissionGuideState => {
  const permissionName = t(`permissionGuide.permission.${permission}`);
  const base = {
    appPath,
    bottomInset: BOTTOM_INSET,
    closeLabel: t('permissionGuide.close'),
    iconLabel: appName,
    launchOrigin,
    missingTimeoutMs: MISSING_TIMEOUT_MS,
    sidebarWidth,
  };

  switch (phase) {
    case 'waiting':
    case 'retry': {
      return {
        ...base,
        accessory: 'appIcon',
        draggable: true,
        subtitle:
          phase === 'retry'
            ? t('permissionGuide.retry.subtitle')
            : t('permissionGuide.waiting.subtitle', { permission: permissionName }),
        title: t('permissionGuide.waiting.title'),
      };
    }
    case 'confirming': {
      return {
        ...base,
        accessory: 'spinner',
        draggable: false,
        subtitle: t('permissionGuide.confirming.subtitle'),
        title: t('permissionGuide.confirming.title'),
      };
    }
    case 'granted': {
      return {
        ...base,
        accessory: 'success',
        draggable: false,
        subtitle: t('permissionGuide.granted.subtitle'),
        title: t('permissionGuide.granted.title', { permission: permissionName }),
      };
    }
    case 'relaunch': {
      return {
        ...base,
        accessory: 'appIcon',
        actionLabel: t('permissionGuide.relaunch.action'),
        actionStyle: 'primary',
        draggable: false,
        subtitle: t('permissionGuide.relaunch.subtitle'),
        title: t('permissionGuide.granted.title', { permission: permissionName }),
      };
    }
    case 'offPane': {
      return {
        ...base,
        accessory: 'settingsIcon',
        actionLabel: t('permissionGuide.offPane.action'),
        actionStyle: 'secondary',
        draggable: false,
        subtitle: t('permissionGuide.offPane.subtitle', { permission: permissionName }),
        title: t('permissionGuide.offPane.title'),
      };
    }
    case 'missing': {
      return {
        ...base,
        accessory: 'settingsIcon',
        actionLabel: t('permissionGuide.missing.action'),
        actionStyle: 'secondary',
        draggable: false,
        subtitle: t('permissionGuide.missing.subtitle'),
        title: t('permissionGuide.missing.title'),
      };
    }
  }
};

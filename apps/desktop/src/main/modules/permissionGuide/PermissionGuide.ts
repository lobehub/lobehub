import type { PermissionGuideStatus } from '@lobechat/electron-client-ipc';
import type * as GuideAddonModule from '@lobechat/electron-mac-permission-guide';
import type { PermissionGuideEvent } from '@lobechat/electron-mac-permission-guide';
import { app as electronApp, screen, shell } from 'electron';

import type { App } from '@/core/App';
import { createLogger } from '@/utils/logger';
import type { PermissionStatus } from '@/utils/permissions';
import {
  getAccessibilityStatus,
  getFullDiskAccessStatus,
  getInputMonitoringStatus,
  getScreenCaptureStatus,
} from '@/utils/permissions';
import * as electronIs from '@/utils/platform';

import type { GuidePhase } from './guideState';
import { buildGuideState } from './guideState';
import type { GuidedPermission } from './settingsPanes';
import { getAppBundlePath, getSettingsPaneUrl, getSettingsSidebarWidth } from './settingsPanes';

const logger = createLogger('modules:permissionGuide');

type GuideAddon = typeof GuideAddonModule;

export const POLL_INTERVAL_MS = 1000;
export const GRANTED_DISMISS_MS = 1200;
export const PROMPT_WAIT_MS = 4000;
export const PROMPT_SETTLE_MS = 1500;
export const TITLE_SETTLE_MS = 1000;

const STATUS_READERS: Record<GuidedPermission, () => PermissionStatus> = {
  accessibility: getAccessibilityStatus,
  fullDisk: getFullDiskAccessStatus,
  inputMonitoring: getInputMonitoringStatus,
  screen: getScreenCaptureStatus,
};

// Screen Recording only takes effect in a fresh process.
const RELAUNCH_REQUIRED = new Set<GuidedPermission>(['screen']);

const AWAITING_USER = new Set<GuidePhase>(['confirming', 'offPane', 'retry', 'waiting']);
const ACCEPTS_DROP = new Set<GuidePhase>(['retry', 'waiting']);

interface ActiveGuide {
  appPath: string;
  granted: boolean;
  lastTitle?: string;
  launchOrigin: { x: number; y: number };
  paneTitle?: string;
  permission: GuidedPermission;
  phase: GuidePhase;
  promptVisible: boolean;
  titleSettled: boolean;
}

export class PermissionGuide {
  private active?: ActiveGuide;
  private addon?: GuideAddon;
  private pollTimer?: ReturnType<typeof setInterval>;
  private phaseTimer?: ReturnType<typeof setTimeout>;
  private titleTimer?: ReturnType<typeof setTimeout>;
  private unsubscribe?: () => void;

  constructor(private readonly app: App) {}

  // `false` means the guide can't run here and the caller keeps its old flow.
  async open(permission: GuidedPermission): Promise<boolean> {
    if (!electronIs.macOS()) return false;
    if (this.isGranted(permission)) return true;

    const addon = await this.loadAddon();
    const appPath = getAppBundlePath(electronApp.getPath('exe'));
    if (!addon || !appPath) return false;

    this.close();
    this.active = {
      appPath,
      granted: false,
      launchOrigin: this.resolveLaunchOrigin(),
      permission,
      phase: 'waiting',
      promptVisible: false,
      titleSettled: false,
    };
    this.unsubscribe = addon.onGuideEvent((event) => this.handleEvent(event));
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);

    this.notify(permission, 'active');
    await this.openSettings(permission);
    this.render();
    logger.info(`[PermissionGuide] opened for ${permission}`);
    return true;
  }

  close() {
    clearInterval(this.pollTimer);
    clearTimeout(this.phaseTimer);
    clearTimeout(this.titleTimer);
    this.pollTimer = undefined;
    this.phaseTimer = undefined;
    this.titleTimer = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    const active = this.active;
    this.active = undefined;
    if (!active) return;
    this.addon?.hideGuide();
    if (!active.granted) this.notify(active.permission, 'dismissed');
  }

  private notify(permission: GuidedPermission, status: PermissionGuideStatus) {
    this.app.browserManager.broadcastToAllWindows('permissionGuideChanged', { permission, status });
  }

  // The panel flies out of the control the user just clicked; a request that
  // did not start from the main window flies out of the window's center.
  private resolveLaunchOrigin() {
    const cursor = screen.getCursorScreenPoint();
    const bounds = this.app.browserManager.getMainWindow()?.browserWindow?.getBounds();
    if (!bounds) return cursor;
    const insideWindow =
      cursor.x >= bounds.x &&
      cursor.x <= bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y <= bounds.y + bounds.height;
    return insideWindow
      ? cursor
      : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }

  private isGranted(permission: GuidedPermission) {
    return STATUS_READERS[permission]() === 'granted';
  }

  private async openSettings(permission: GuidedPermission) {
    await shell.openExternal(getSettingsPaneUrl(permission));
    this.addon?.activateSettings();

    // The deep link needs a moment to switch panes; the title seen after that
    // is the one the user must stay on.
    clearTimeout(this.titleTimer);
    if (this.active) this.active.titleSettled = false;
    this.titleTimer = setTimeout(() => {
      if (!this.active) return;
      this.active.titleSettled = true;
      this.active.paneTitle = this.active.lastTitle;
    }, TITLE_SETTLE_MS);
  }

  private async loadAddon(): Promise<GuideAddon | undefined> {
    if (this.addon) return this.addon;
    try {
      const addon = await import('@lobechat/electron-mac-permission-guide');
      if (!addon.isSupported()) return undefined;
      this.addon = addon;
      return addon;
    } catch (error) {
      logger.warn('[PermissionGuide] native addon unavailable:', error);
      return undefined;
    }
  }

  private poll() {
    const active = this.active;
    if (!active || active.phase === 'granted' || active.phase === 'relaunch') return;
    if (!this.isGranted(active.permission)) return;

    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    active.granted = true;
    this.notify(active.permission, 'granted');
    logger.info(`[PermissionGuide] ${active.permission} granted`);

    if (RELAUNCH_REQUIRED.has(active.permission)) {
      this.setPhase('relaunch');
      return;
    }
    this.setPhase('granted');
    this.phaseTimer = setTimeout(() => {
      this.close();
      this.app.browserManager.showMainWindow();
    }, GRANTED_DISMISS_MS);
  }

  private settleConfirmation(fallback: GuidePhase) {
    const active = this.active;
    if (active?.phase !== 'confirming') return;
    if (this.isGranted(active.permission)) {
      this.poll();
      return;
    }
    this.setPhase(fallback);
  }

  private handleEvent(event: PermissionGuideEvent) {
    const active = this.active;
    if (!active) return;

    switch (event.type) {
      case 'close': {
        this.close();
        return;
      }
      case 'action': {
        this.handleAction(active);
        return;
      }
      case 'dragEnded': {
        if (!event.dropped || !ACCEPTS_DROP.has(active.phase)) return;
        this.setPhase('confirming');
        // Dropping an app that is already listed, or onto the wrong spot,
        // raises no prompt; return to the drag state instead of spinning.
        this.phaseTimer = setTimeout(() => {
          if (!this.active?.promptVisible) this.settleConfirmation('waiting');
        }, PROMPT_WAIT_MS);
        return;
      }
      case 'promptShown': {
        active.promptVisible = true;
        if (AWAITING_USER.has(active.phase)) this.setPhase('confirming');
        return;
      }
      case 'promptDismissed': {
        active.promptVisible = false;
        if (active.phase !== 'confirming') return;
        clearTimeout(this.phaseTimer);
        this.phaseTimer = setTimeout(() => this.settleConfirmation('retry'), PROMPT_SETTLE_MS);
        return;
      }
      case 'windowTitle': {
        active.lastTitle = event.title;
        if (!active.titleSettled) return;
        if (!active.paneTitle) {
          active.paneTitle = event.title;
          return;
        }
        if (event.title === active.paneTitle) {
          if (active.phase === 'offPane') this.setPhase('waiting');
        } else if (ACCEPTS_DROP.has(active.phase)) {
          this.setPhase('offPane');
        }
        return;
      }
      case 'navigationClicked': {
        if (active.lastTitle === undefined && ACCEPTS_DROP.has(active.phase)) {
          this.setPhase('offPane');
        }
        return;
      }
      case 'settingsLost': {
        if (AWAITING_USER.has(active.phase)) this.setPhase('missing');
        return;
      }
      case 'settingsFound': {
        if (active.phase === 'missing') this.setPhase('waiting');
        return;
      }
    }
  }

  private handleAction(active: ActiveGuide) {
    switch (active.phase) {
      case 'relaunch': {
        this.close();
        electronApp.relaunch();
        electronApp.exit(0);
        return;
      }
      case 'missing': {
        void this.openSettings(active.permission);
        return;
      }
      case 'offPane': {
        void this.openSettings(active.permission);
        this.setPhase('waiting');
        return;
      }
    }
  }

  private setPhase(phase: GuidePhase) {
    if (!this.active) return;
    clearTimeout(this.phaseTimer);
    this.phaseTimer = undefined;
    this.active.phase = phase;
    this.render();
  }

  private render() {
    if (!this.active || !this.addon) return;
    this.addon.showGuide(
      buildGuideState({
        appName: electronApp.getName(),
        appPath: this.active.appPath,
        launchOrigin: this.active.launchOrigin,
        permission: this.active.permission,
        phase: this.active.phase,
        sidebarWidth: getSettingsSidebarWidth(process.getSystemVersion()),
        t: this.app.i18n.ns('dialog'),
      }),
    );
  }
}

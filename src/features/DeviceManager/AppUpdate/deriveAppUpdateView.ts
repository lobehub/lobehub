import type { DeviceAppUpdateStateResult } from '@lobechat/types';

/** A restart the user asked for, followed until the device comes back. */
export interface AppUpdateInstall {
  targetVersion: string;
  /** No answer on the target version within the wait window. */
  timedOut: boolean;
}

export type AppUpdateUnsupportedReason = 'cli' | 'devBuild' | 'outdated';

export type AppUpdateView =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'unsupported'; reason: AppUpdateUnsupportedReason }
  | { kind: 'idle'; outcome?: 'latest' | { error: string } }
  | { kind: 'checking' }
  | { kind: 'downloading'; progress?: number; targetVersion?: string }
  | { kind: 'ready'; targetVersion: string }
  | { kind: 'restarting'; targetVersion: string }
  | { kind: 'updated'; version: string }
  | { kind: 'installFailed'; currentVersion: string }
  | { kind: 'timedOut'; targetVersion: string };

/**
 * Turn the device's latest answer (plus a restart in flight) into what the
 * version section shows.
 *
 * During a restart the device first stays on the old version (it quits after
 * answering), then drops offline, then reconnects. Only a reconnect on the
 * target version is success; a reconnect on anything else — the fresh process
 * no longer holds a downloaded update — means the install didn't apply.
 */
export const deriveAppUpdateView = (
  result: DeviceAppUpdateStateResult | undefined,
  install: AppUpdateInstall | null,
  hasCliChannel: boolean,
): AppUpdateView => {
  if (install) {
    if (result?.status === 'ok') {
      const { currentVersion, stage } = result.state;
      if (currentVersion === install.targetVersion)
        return { kind: 'updated', version: currentVersion };
      if (stage !== 'downloaded') return { currentVersion, kind: 'installFailed' };
    }
    return install.timedOut
      ? { kind: 'timedOut', targetVersion: install.targetVersion }
      : { kind: 'restarting', targetVersion: install.targetVersion };
  }

  if (!result) return { kind: 'loading' };
  if (result.status !== 'ok') {
    if (result.status === 'unavailable') return { kind: 'unavailable' };
    // One device can hold both the desktop app and `lh connect`; when the CLI
    // answers, the desktop app is not the outdated party.
    return { kind: 'unsupported', reason: hasCliChannel ? 'cli' : 'outdated' };
  }

  const { errorMessage, progress, stage, targetVersion } = result.state;
  switch (stage) {
    case 'unsupported': {
      return { kind: 'unsupported', reason: 'devBuild' };
    }
    case 'checking': {
      return { kind: 'checking' };
    }
    case 'downloading': {
      return { kind: 'downloading', progress, targetVersion };
    }
    case 'downloaded': {
      return targetVersion ? { kind: 'ready', targetVersion } : { kind: 'idle' };
    }
    case 'latest': {
      return { kind: 'idle', outcome: 'latest' };
    }
    case 'error': {
      return { kind: 'idle', outcome: { error: errorMessage ?? '' } };
    }
    default: {
      return { kind: 'idle' };
    }
  }
};

/** Views whose next state only the device can tell us, so the section polls. */
export const isAppUpdatePolling = (view: AppUpdateView): boolean =>
  view.kind === 'checking' || view.kind === 'downloading' || view.kind === 'restarting';

/**
 * Which button the desktop app's row offers. Every state the user can act on
 * keeps one — `unavailable` isn't polled, so without a retry the section would
 * stay stuck until the panel is reopened.
 */
export type AppUpdateAction =
  'check' | 'retry' | 'checking' | 'downloading' | 'install' | 'restarting';

export const getAppUpdateAction = (view: AppUpdateView): AppUpdateAction | undefined => {
  switch (view.kind) {
    case 'idle':
    case 'installFailed':
    case 'timedOut': {
      return 'check';
    }
    case 'unavailable': {
      return 'retry';
    }
    case 'checking': {
      return 'checking';
    }
    case 'downloading': {
      return 'downloading';
    }
    case 'ready': {
      return 'install';
    }
    case 'restarting': {
      return 'restarting';
    }
    default: {
      return undefined;
    }
  }
};

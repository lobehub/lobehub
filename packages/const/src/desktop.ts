import type { DesktopHotkeyConfig } from '@lobechat/types';

import { DESKTOP_HOTKEYS_REGISTRATION } from './desktopGlobalShortcuts';

export const DESKTOP_USER_ID = 'DEFAULT_DESKTOP_USER';

export const DEFAULT_DESKTOP_HOTKEY_CONFIG: DesktopHotkeyConfig =
  DESKTOP_HOTKEYS_REGISTRATION.reduce((acc: DesktopHotkeyConfig, item) => {
    acc[item.id] = item.keys;
    return acc;
  }, {} as DesktopHotkeyConfig);

/** OIDC client the LobeHub desktop app signs in with. */
export const LOBEHUB_DESKTOP_CLIENT_ID = 'lobehub-desktop';

/**
 * OIDC client Lobot signs in with. Lobot is a separate desktop app, so it gets
 * its own client instead of borrowing LobeHub Desktop's: its grants, sessions
 * and token usage stay apart and either app can be revoked on its own.
 */
export const LOBOT_DESKTOP_CLIENT_ID = 'lobot-desktop';

/** OIDC client the Lobot iOS app signs in with, through an HTTPS universal-link callback. */
export const LOBOT_MOBILE_CLIENT_ID = 'lobot-mobile';

/** Desktop apps that sign in through the `/oidc/callback/desktop` handoff. */
export const DESKTOP_OIDC_CLIENT_IDS: readonly string[] = [
  LOBEHUB_DESKTOP_CLIENT_ID,
  LOBOT_DESKTOP_CLIENT_ID,
];

export const isDesktopOidcClient = (clientId?: string | null): boolean =>
  !!clientId && DESKTOP_OIDC_CLIENT_IDS.includes(clientId);

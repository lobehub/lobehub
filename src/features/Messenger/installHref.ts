import urlJoin from 'url-join';

import { useAppOrigin } from '@/hooks/useAppOrigin';

/** Platforms whose "Connect" flow starts at the LobeHub OAuth install endpoint. */
export type MessengerOAuthInstallPlatform = 'discord' | 'slack';

const MESSENGER_INSTALL_PATHS: Record<MessengerOAuthInstallPlatform, string> = {
  discord: '/api/agent/messenger/discord/install',
  slack: '/api/agent/messenger/slack/install',
};

/**
 * The install endpoint must be opened as an absolute web URL. On web a relative
 * path would resolve against the site origin anyway, but on desktop the renderer
 * runs on `app://renderer`, so a relative `target="_blank"` link becomes
 * `app://renderer/api/...` and the main process denies it instead of handing it
 * to the system browser. Returns `undefined` until the origin is known so the
 * caller can keep the button disabled.
 */
export const resolveMessengerInstallHref = (
  platform: MessengerOAuthInstallPlatform,
  appOrigin: string | undefined,
): string | undefined => {
  if (!appOrigin) return undefined;

  return urlJoin(appOrigin, MESSENGER_INSTALL_PATHS[platform]);
};

export const useMessengerInstallHref = (
  platform: MessengerOAuthInstallPlatform,
): string | undefined => {
  const appOrigin = useAppOrigin();

  return resolveMessengerInstallHref(platform, appOrigin);
};

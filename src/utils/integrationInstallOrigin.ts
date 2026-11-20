import { OFFICIAL_CLOUD_URL, OFFICIAL_URL } from '@lobechat/const';

// shortcut: keep cloud installs on the app origin until gateway login redirects are fixed.
export const integrationInstallOrigin = (appOrigin: string): string =>
  appOrigin.replace(/\/+$/, '') === OFFICIAL_CLOUD_URL ? OFFICIAL_URL : appOrigin;

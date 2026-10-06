import { openTrustedExternalUrl } from '@/utils/openTrustedExternalUrl';

/**
 * Terminal output is attacker-reachable — any command can print an escape
 * sequence — so link opening goes through the shared trusted-URL gate
 * (http(s) only, no current-window navigation). See openTrustedExternalUrl.
 */
export const openTerminalLink = (uri: string) => {
  openTrustedExternalUrl(uri);
};

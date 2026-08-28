import { getMessengerTelegramConfig } from '@/config/messenger';
import type { SafeMessengerAccountLink } from '@/database/models/messengerAccountLink';

import { TELEGRAM_INSTALLATION_KEY } from './installations/telegram';

/**
 * Synthetic System Bot connection for the Telegram singleton.
 *
 * `installedAt` stays a `Date` so each consumer can keep its own serialization
 * contract (the TRPC procedure returns `Date`s, the tool runtime returns ISO
 * strings).
 */
export interface TelegramInstallationView {
  applicationId: string;
  enterpriseId: null;
  id: string;
  installedAt: Date;
  isEnterpriseInstall: false;
  platform: 'telegram';
  scope: '';
  tenantId: '';
  tenantName: 'Telegram';
}

type TelegramLinkCandidate = Pick<SafeMessengerAccountLink, 'createdAt' | 'platform'>;

/**
 * Telegram bots are env/DB-backed singletons — they never get a row in
 * `messenger_installations` (see `installations/telegram.ts`). Without this
 * synthesis every "which messengers am I connected to?" surface (the Message
 * tool's `listMessengers`, `lobehub bot messengers`) sees Telegram nowhere and
 * falsely concludes the platform is unconfigured, even while `sendMessengerPush`
 * delivers through the account link just fine.
 *
 * Shared by the `messenger.listMyInstallations` TRPC procedure (client-executed
 * tool calls + CLI) and the server-side Message tool runtime, so the two can't
 * drift apart again.
 *
 * Returns a virtual install entry when both gates pass:
 *   1. The deployment has Telegram credentials (otherwise the singleton
 *      genuinely isn't set up)
 *   2. `links` contains an account link for `platform='telegram'` (otherwise the
 *      bot exists globally but isn't routed to this user — surfacing it would
 *      let anyone send through a bot they haven't linked)
 */
export const maybeSynthesizeTelegramInstall = async (
  links: readonly TelegramLinkCandidate[],
): Promise<TelegramInstallationView | undefined> => {
  const telegramConfig = await getMessengerTelegramConfig();
  if (!telegramConfig) return undefined;

  const link = links.find((item) => item.platform === 'telegram');
  if (!link) return undefined;

  return {
    applicationId: TELEGRAM_INSTALLATION_KEY,
    enterpriseId: null,
    id: TELEGRAM_INSTALLATION_KEY,
    installedAt: link.createdAt instanceof Date ? link.createdAt : new Date(link.createdAt),
    isEnterpriseInstall: false,
    platform: 'telegram',
    scope: '',
    tenantId: '',
    tenantName: 'Telegram',
  };
};

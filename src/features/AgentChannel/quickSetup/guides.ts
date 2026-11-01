import {
  buildDiscordBotPageUrl,
  buildDiscordInviteUrl,
  buildSlackAppPageUrl,
  buildSlackCreateAppUrl,
  DISCORD_DEVELOPER_PORTAL_URL,
  FEISHU_CONSOLE_URL,
  LINE_ACCOUNT_ENTRY_URL,
  LINE_ACCOUNT_MANAGER_URL,
  LINE_CONSOLE_URL,
  QQ_BOT_CONSOLE_URL,
  SLACK_APPS_URL,
  TELEGRAM_BOTFATHER_URL,
} from './links';

export type SetupLinkLabel =
  | 'createLineAccount'
  | 'createSlackApp'
  | 'inviteBot'
  | 'openBotFather'
  | 'openBotSettings'
  | 'openLineAccountManager'
  | 'openConsole'
  | 'openSlackApp';

export interface SetupStep {
  /**
   * Keys of the credential fields this step is about (`applicationId`, or a key
   * under `credentials`; `extras` is the platform's helper under them). While a bot is being set up they are filled in right
   * under the step; a saved bot keeps them in its credentials group instead.
   */
  fields?: string[];
  /** i18n: `channel.quickSetup.<guide>.<key>.title` / `.desc` (agent namespace). */
  key: string;
  link?: { href: string; label: SetupLinkLabel };
  /** The step's link needs the application ID typed into the form first. */
  needsApplicationId?: boolean;
}

export interface SetupGuide {
  /** i18n namespace segment; Feishu and Lark share one guide. */
  guide: string;
  /** Feishu / Lark can create the whole bot app from one scan. */
  scanToCreate?: boolean;
  steps: SetupStep[];
}

export interface SetupGuideContext {
  /** Prefill for apps created from a link (Slack manifest). */
  appDescription?: string;
  /** Application ID already in the form, unlocking deep links into that app. */
  applicationId?: string;
  appName: string;
}

/**
 * Step-by-step setup for each bot platform, pointing at the exact console page
 * for every step. Links into a specific app unlock once its ID is known.
 */
export const getSetupGuide = (
  platformId: string,
  { applicationId, appDescription, appName }: SetupGuideContext,
): SetupGuide | undefined => {
  const appId = applicationId?.trim() || undefined;

  switch (platformId) {
    case 'feishu':
    case 'lark': {
      return {
        guide: 'feishu',
        scanToCreate: true,
        steps: [
          {
            key: 'create',
            fields: ['applicationId', 'appSecret'],
            link: { href: FEISHU_CONSOLE_URL[platformId], label: 'openConsole' },
          },
          { key: 'bot' },
          { key: 'events' },
          { key: 'publish' },
        ],
      };
    }
    case 'slack': {
      const appPage = (page: 'general' | 'oauth') =>
        appId ? buildSlackAppPageUrl(appId, page) : SLACK_APPS_URL;
      return {
        guide: 'slack',
        steps: [
          {
            key: 'create',
            link: {
              href: buildSlackCreateAppUrl({ description: appDescription, name: appName }),
              label: 'createSlackApp',
            },
          },
          {
            key: 'install',
            fields: ['botToken'],
            link: { href: appPage('oauth'), label: 'openSlackApp' },
          },
          {
            key: 'tokens',
            fields: ['applicationId', 'signingSecret', 'appToken'],
            link: { href: appPage('general'), label: 'openSlackApp' },
          },
        ],
      };
    }
    case 'discord': {
      return {
        guide: 'discord',
        steps: [
          { key: 'create', link: { href: DISCORD_DEVELOPER_PORTAL_URL, label: 'openConsole' } },
          { key: 'credentials', fields: ['applicationId', 'publicKey'] },
          {
            key: 'bot',
            fields: ['botToken'],
            link: {
              href: appId ? buildDiscordBotPageUrl(appId) : DISCORD_DEVELOPER_PORTAL_URL,
              label: 'openBotSettings',
            },
          },
          {
            key: 'invite',
            link: appId ? { href: buildDiscordInviteUrl(appId), label: 'inviteBot' } : undefined,
            needsApplicationId: !appId,
          },
        ],
      };
    }
    case 'telegram': {
      return {
        guide: 'telegram',
        steps: [
          { key: 'botfather', link: { href: TELEGRAM_BOTFATHER_URL, label: 'openBotFather' } },
          { key: 'token', fields: ['botToken'] },
          { key: 'privacy' },
        ],
      };
    }
    case 'qq': {
      return {
        guide: 'qq',
        steps: [
          { key: 'create', link: { href: QQ_BOT_CONSOLE_URL, label: 'openConsole' } },
          { key: 'credentials', fields: ['applicationId', 'appSecret'] },
        ],
      };
    }
    case 'line': {
      return {
        guide: 'line',
        // LINE no longer creates Messaging API channels in the Developers Console;
        // they come from an Official Account, and the webhook is set by hand.
        steps: [
          { key: 'account', link: { href: LINE_ACCOUNT_ENTRY_URL, label: 'createLineAccount' } },
          {
            key: 'messagingApi',
            link: { href: LINE_ACCOUNT_MANAGER_URL, label: 'openLineAccountManager' },
          },
          {
            key: 'credentials',
            // `extras` is the platform's helper button ("Fetch from LINE"), which fills the
            // destination user ID from the access token, so it follows the fields it needs.
            fields: ['channelAccessToken', 'channelSecret', 'applicationId', 'extras'],
            link: { href: LINE_CONSOLE_URL, label: 'openConsole' },
          },
          { key: 'webhook' },
        ],
      };
    }
    default: {
      return undefined;
    }
  }
};

/**
 * Credential field keys a platform's setup steps fill in place. Empty for a
 * platform without a guide, so its credentials stay in one group.
 */
export const getInlineFieldKeys = (platformId: string): Set<string> =>
  new Set(
    (getSetupGuide(platformId, { appName: '' })?.steps ?? []).flatMap((step) => step.fields ?? []),
  );

/**
 * Where the "save and connect" step goes: right after the last step that asks for a credential,
 * since everything after it (inviting the bot, turning on a webhook, subscribing to events) needs
 * the bot to be saved and running. A guide whose steps ask for nothing gets it at the end.
 */
export const connectStepIndex = (steps: SetupStep[]): number => {
  const last = steps.findLastIndex((step) => (step.fields?.length ?? 0) > 0);
  return last === -1 ? steps.length : last + 1;
};

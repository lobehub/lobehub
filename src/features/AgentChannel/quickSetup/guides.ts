import {
  buildDiscordBotPageUrl,
  buildDiscordInviteUrl,
  buildSlackAppPageUrl,
  buildSlackCreateAppUrl,
  DISCORD_DEVELOPER_PORTAL_URL,
  FEISHU_CONSOLE_URL,
  LINE_CONSOLE_URL,
  QQ_BOT_CONSOLE_URL,
  SLACK_APPS_URL,
  TELEGRAM_BOTFATHER_URL,
} from './links';

export type SetupLinkLabel =
  | 'createSlackApp'
  | 'inviteBot'
  | 'openBotFather'
  | 'openBotSettings'
  | 'openConsole'
  | 'openSlackApp';

export interface SetupStep {
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
          { key: 'create', link: { href: FEISHU_CONSOLE_URL[platformId], label: 'openConsole' } },
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
          { key: 'install', link: { href: appPage('oauth'), label: 'openSlackApp' } },
          { key: 'tokens', link: { href: appPage('general'), label: 'openSlackApp' } },
        ],
      };
    }
    case 'discord': {
      return {
        guide: 'discord',
        steps: [
          { key: 'create', link: { href: DISCORD_DEVELOPER_PORTAL_URL, label: 'openConsole' } },
          { key: 'credentials' },
          {
            key: 'bot',
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
          { key: 'token' },
          { key: 'privacy' },
        ],
      };
    }
    case 'qq': {
      return {
        guide: 'qq',
        steps: [
          { key: 'create', link: { href: QQ_BOT_CONSOLE_URL, label: 'openConsole' } },
          { key: 'credentials' },
        ],
      };
    }
    case 'line': {
      return {
        guide: 'line',
        steps: [
          { key: 'create', link: { href: LINE_CONSOLE_URL, label: 'openConsole' } },
          { key: 'credentials' },
        ],
      };
    }
    default: {
      return undefined;
    }
  }
};

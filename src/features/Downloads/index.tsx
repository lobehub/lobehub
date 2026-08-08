'use client';

import { DOWNLOAD_URL, isDesktop, USAGE_DOCUMENTS } from '@lobechat/const';
import { Block, CopyButton, Flexbox, Icon, Text, ThemeProvider, Tooltip } from '@lobehub/ui';
import { Button, ScrollArea } from '@lobehub/ui/base-ui';
import { Lark, Line, QQ, WeChat } from '@lobehub/ui/icons';
import { createStaticStyles, cx } from 'antd-style';
import {
  BadgeCheck,
  ChevronRight,
  Download,
  MessageCircle,
  Monitor,
  Smartphone,
  Terminal,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { PlatformBrandIcon, SUPPORTED_MESSENGER_PLATFORMS } from '@/features/Messenger/constants';

import { AndroidPlatformIcon, ApplePlatformIcon } from './MobilePlatformIcons';

const CLI_HELP_COMMAND = 'lobehub --help';
// Mirrors the public `lobehub --help` output; terminal output intentionally stays untranslated.
const CLI_HELP_OUTPUT = `Usage: lh [options] [command]

LobeHub CLI - manage and connect to LobeHub services

Options:
  -V, --version          output the version number
  -h, --help             display help for command

Commands:
  login [options]        Log in to LobeHub via browser (Device Code Flow) or
                         configure API key server
  logout                 Log out and remove stored credentials
  completion [shell]     Output shell completion script
  man [command...]       Show a manual page for the CLI or a subcommand
  connect [options]      Connect to the device gateway and listen for tool calls
  disconnect             Disconnect from the device gateway (alias for \`connect
                         stop\`)
  device                 Manage connected devices
  status [options]       Check if gateway connection can be established
  doc                    Manage documents
  search [options]       Search across local resources or the web
  kb                     Manage knowledge bases, folders, documents, and files
  memory                 Manage user memories
  agent                  Manage agents
  agent-group            Manage agent groups
  agent-signal           Inspect and trigger Agent Signal source events
  bot                    Manage bot integrations
  generate|gen           Generate content (text, image, video, speech)
  file                   Manage files
  hetero                 Run heterogeneous agent CLIs (Claude Code / Codex) and
                         stream their output
  skill                  Manage agent skills
  session-group          Manage agent session groups
  task                   Manage agent tasks
  thread                 Manage message threads
  topic                  Manage conversation topics
  message                Manage messages
  model                  Manage AI models
  notify [options]       Send a callback message to a topic and trigger the
                         agent to process it
  provider               Manage AI providers
  plugin                 Manage plugins
  user                   Manage user account and settings
  verify                 Manage the Agent Run delivery checker (criteria,
                         rubrics, plans, results)
  whoami [options]       Display current user information
  usage [options]        View usage statistics
  eval                   Manage evaluation workflows
  migrate                Migrate data from external tools (OpenClaw, ChatGPT,
                         Claude, etc.)
  update [options]       Update the LobeHub CLI to the latest published version
  help [command]         display help for command`;
const CLI_INSTALL_COMMAND = 'npm install -g @lobehub/cli';
const CHANNEL_DOCS_URL = `${USAGE_DOCUMENTS}/channels`;
const MANUAL_MESSENGER_PLATFORMS = [
  {
    docsUrl: `${CHANNEL_DOCS_URL}/feishu`,
    icon: Lark.Color,
    id: 'feishu',
    name: 'Feishu / Lark',
  },
  { docsUrl: `${CHANNEL_DOCS_URL}/line`, icon: Line.Color, id: 'line', name: 'LINE' },
  { docsUrl: `${CHANNEL_DOCS_URL}/wechat`, icon: WeChat.Color, id: 'wechat', name: 'WeChat' },
  { docsUrl: `${CHANNEL_DOCS_URL}/qq`, icon: QQ.Color, id: 'qq', name: 'QQ' },
] as const;

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionRow: css`
    flex-wrap: wrap;
    margin-block-start: auto;
  `,
  card: css`
    min-height: 260px;
    padding: 24px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  cliCard: css`
    overflow: hidden;
    grid-column: 1 / -1;
    grid-row: 3;

    min-height: 240px;
    padding: 0;
    border-color: ${cssVar.colorBorder};

    background: transparent;

    @media (width <= 860px) {
      grid-column: auto;
      grid-row: auto;
    }
  `,
  cliCommand: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font: inherit;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  cliInstallLine: css`
    display: flex;
    gap: 8px;
    align-items: center;

    width: fit-content;
    min-width: 0;
    max-width: 100%;
  `,
  terminalBody: css`
    display: flex;
    flex-direction: column;
    gap: 16px;

    padding: 24px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSize};
    line-height: 1.57;

    @media (width <= 520px) {
      padding: 16px;
    }
  `,
  terminalControl: css`
    width: 10px;
    height: 10px;
    border-radius: 999px;
    box-shadow: inset 0 0 0 1px ${cssVar.colorFill};
  `,
  terminalControlError: css`
    background: ${cssVar.colorError};
  `,
  terminalControlSuccess: css`
    background: ${cssVar.colorSuccess};
  `,
  terminalControlWarning: css`
    background: ${cssVar.colorWarning};
  `,
  terminalControls: css`
    display: flex;
    gap: 8px;
  `,
  terminalHeader: css`
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;

    min-height: 44px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  terminalLabel: css`
    display: flex;
    gap: 8px;
    align-items: center;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  terminalLine: css`
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  `,
  terminalOutput: css`
    min-width: max-content;
    margin: 0;

    font: inherit;
    color: ${cssVar.colorTextSecondary};
    white-space: pre;
  `,
  terminalOutputViewport: css`
    height: 360px;

    @media (width <= 520px) {
      height: 320px;
    }
  `,
  terminalPath: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  terminalPrompt: css`
    flex-shrink: 0;
    font-weight: ${cssVar.fontWeightStrong};
    color: ${cssVar.colorSuccess};
  `,
  terminalTheme: css`
    min-height: 240px;
    color: ${cssVar.colorText};
    background: ${cssVar.colorBgContainer};
  `,
  content: css`
    width: min(100%, 1120px);
    margin-block: 0;
    margin-inline: auto;
    padding-block: 32px 96px;
    padding-inline: 24px;

    @media (width <= 760px) {
      padding-block-start: 16px;
      padding-inline: 16px;
    }
  `,
  bentoGrid: css`
    display: grid;
    grid-template-columns: minmax(0, 0.88fr) minmax(0, 1.12fr);
    grid-template-rows: repeat(2, minmax(220px, auto));
    gap: 16px;

    @media (width <= 860px) {
      grid-template-columns: 1fr;
      grid-template-rows: none;
    }
  `,
  iconBox: css`
    width: 44px;
    height: 44px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillQuaternary};
  `,
  page: css`
    overflow-y: auto;
    height: 100%;
    min-height: 100%;
    background: ${cssVar.colorBgLayout};
  `,
  pageHeader: css`
    margin-block-end: 24px;
    text-align: start;
  `,
  pageTitle: css`
    margin: 0;
    font-size: 30px;
    line-height: 1.2;
    letter-spacing: 0;
  `,
  platformGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-block: 22px;

    @media (width <= 520px) {
      grid-template-columns: 1fr;
    }
  `,
  platformItem: css`
    cursor: pointer;

    justify-content: flex-start;

    width: 100%;
    min-height: 44px;
    padding-inline: 12px;
    border-radius: 10px;

    color: ${cssVar.colorText};
    text-align: start;

    background: ${cssVar.colorFillQuaternary};

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  platformChevron: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  platformIcon: css`
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    line-height: 0;
  `,
  platformLabel: css`
    display: inline-flex;
    flex: 1;
    gap: 6px;
    align-items: center;

    min-width: 0;
  `,
  platformName: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  platformVerified: css`
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;

    line-height: 0;
    color: ${cssVar.colorSuccess};
  `,
  desktopCard: css`
    grid-column: 1;
    grid-row: 2;

    @media (width <= 860px) {
      grid-column: auto;
      grid-row: auto;
    }
  `,
  messengerCard: css`
    grid-column: 2;
    grid-row: 1 / span 2;

    @media (width <= 860px) {
      grid-column: auto;
      grid-row: auto;
    }
  `,
  mobileCard: css`
    grid-column: 1;
    grid-row: 1;

    @media (width <= 860px) {
      grid-column: auto;
      grid-row: auto;
    }
  `,
  mobilePlatformIcons: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;
    color: ${cssVar.colorTextTertiary};
  `,
  desktopBentoGrid: css`
    grid-template-rows: minmax(260px, auto);

    @media (width <= 860px) {
      grid-template-rows: none;
    }
  `,
  desktopCliCard: css`
    grid-row: 2;

    @media (width <= 860px) {
      grid-row: auto;
    }
  `,
  desktopMessengerCard: css`
    grid-row: 1;

    @media (width <= 860px) {
      grid-row: auto;
    }
  `,
}));

const openExternal = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

const DownloadsPage = memo(() => {
  const { t } = useTranslation('setting');
  const navigate = useNavigate();

  const renderMessengerPlatformButton = (
    id: string,
    name: string,
    icon: ReactNode,
    onClick: () => void,
    isQuickSetup = false,
  ) => (
    <Button
      block
      className={styles.platformItem}
      key={id}
      icon={
        <span aria-hidden className={styles.platformIcon}>
          {icon}
        </span>
      }
      onClick={onClick}
    >
      <span className={styles.platformLabel}>
        <span className={styles.platformName}>{name}</span>
        {isQuickSetup && (
          <Tooltip title={t('downloads.messenger.quickSetupTooltip')}>
            <span
              aria-label={t('downloads.messenger.quickSetup')}
              className={styles.platformVerified}
              role="img"
            >
              <BadgeCheck aria-hidden size={15} />
            </span>
          </Tooltip>
        )}
      </span>
      <ChevronRight aria-hidden className={styles.platformChevron} size={14} />
    </Button>
  );

  const renderMessengerPlatformGrid = () => {
    return (
      <>
        {SUPPORTED_MESSENGER_PLATFORMS.map((platform) =>
          renderMessengerPlatformButton(
            platform.id,
            platform.name,
            <PlatformBrandIcon platform={platform.id} size={18} />,
            () => navigate('/settings/messenger'),
            true,
          ),
        )}
        {MANUAL_MESSENGER_PLATFORMS.map((platform) => {
          const PlatformIcon = platform.icon;
          return renderMessengerPlatformButton(
            platform.id,
            platform.name,
            <PlatformIcon size={18} />,
            () => openExternal(platform.docsUrl),
          );
        })}
      </>
    );
  };

  return (
    <div className={styles.page}>
      <main className={styles.content}>
        <header className={styles.pageHeader}>
          <Text as="h1" className={styles.pageTitle} weight={700}>
            {t('downloads.title')}
          </Text>
        </header>

        <div className={cx(styles.bentoGrid, isDesktop && styles.desktopBentoGrid)}>
          <Block className={cx(styles.card, styles.mobileCard)}>
            <Flexbox gap={18} height="100%">
              <Flexbox align="center" className={styles.iconBox} justify="center">
                <Icon icon={Smartphone} size={22} />
              </Flexbox>
              <Flexbox gap={8}>
                <Text as="h2" style={{ fontSize: 20 }} weight={700}>
                  {t('downloads.mobile.title')}
                </Text>
                <Text type="secondary">{t('downloads.mobile.desc')}</Text>
              </Flexbox>
              <Flexbox horizontal align="center" className={styles.actionRow} gap={10}>
                <Button type="primary" onClick={() => openExternal(DOWNLOAD_URL.mobile)}>
                  {t('downloads.mobile.cta')}
                </Button>
                <span aria-hidden className={styles.mobilePlatformIcons}>
                  <ApplePlatformIcon size={16} />
                  <AndroidPlatformIcon size={14} />
                </span>
              </Flexbox>
            </Flexbox>
          </Block>

          {!isDesktop && (
            <Block className={cx(styles.card, styles.desktopCard)}>
              <Flexbox gap={18} height="100%">
                <Flexbox align="center" className={styles.iconBox} justify="center">
                  <Icon icon={Monitor} size={22} />
                </Flexbox>
                <Flexbox gap={8}>
                  <Text as="h2" style={{ fontSize: 20 }} weight={700}>
                    {t('downloads.desktop.title')}
                  </Text>
                  <Text type="secondary">{t('downloads.desktop.desc')}</Text>
                </Flexbox>
                <Flexbox horizontal className={styles.actionRow} gap={10}>
                  <Button icon={Download} onClick={() => openExternal(DOWNLOAD_URL.default)}>
                    {t('downloads.desktop.cta')}
                  </Button>
                </Flexbox>
              </Flexbox>
            </Block>
          )}

          <Block
            className={cx(
              styles.card,
              styles.messengerCard,
              isDesktop && styles.desktopMessengerCard,
            )}
          >
            <Flexbox gap={18} height="100%">
              <Flexbox align="center" className={styles.iconBox} justify="center">
                <Icon icon={MessageCircle} size={22} />
              </Flexbox>
              <Flexbox gap={8}>
                <Text as="h2" style={{ fontSize: 20 }} weight={700}>
                  {t('downloads.messenger.title')}
                </Text>
                <Text type="secondary">{t('downloads.messenger.desc')}</Text>
              </Flexbox>
              <div className={styles.platformGrid}>{renderMessengerPlatformGrid()}</div>
              <Flexbox horizontal className={styles.actionRow} gap={10}>
                <Button icon={ChevronRight} onClick={() => navigate('/settings/messenger')}>
                  {t('downloads.messenger.cta')}
                </Button>
              </Flexbox>
            </Flexbox>
          </Block>

          <Block className={cx(styles.card, styles.cliCard, isDesktop && styles.desktopCliCard)}>
            <ThemeProvider
              appearance="dark"
              className={styles.terminalTheme}
              defaultAppearance="dark"
              defaultThemeMode="dark"
              theme={{ cssVar: { key: 'lobe-vars' } }}
            >
              <div className={styles.terminalHeader}>
                <div aria-hidden className={styles.terminalControls}>
                  <span className={cx(styles.terminalControl, styles.terminalControlError)} />
                  <span className={cx(styles.terminalControl, styles.terminalControlWarning)} />
                  <span className={cx(styles.terminalControl, styles.terminalControlSuccess)} />
                </div>
                <div className={styles.terminalLabel}>
                  <Icon icon={Terminal} size={14} />
                  <span>lobehub-cli — zsh</span>
                </div>
                <span />
              </div>

              <div className={styles.terminalBody}>
                <div className={styles.cliInstallLine}>
                  <span aria-hidden className={styles.terminalPath}>
                    ~
                  </span>
                  <span aria-hidden className={styles.terminalPrompt}>
                    %
                  </span>
                  <code className={styles.cliCommand}>{CLI_INSTALL_COMMAND}</code>
                  <CopyButton content={CLI_INSTALL_COMMAND} size="small" />
                </div>

                <div className={styles.terminalLine}>
                  <span aria-hidden className={styles.terminalPath}>
                    ~
                  </span>
                  <span aria-hidden className={styles.terminalPrompt}>
                    %
                  </span>
                  <code>{CLI_HELP_COMMAND}</code>
                </div>

                <ScrollArea disableContentFit scrollFade className={styles.terminalOutputViewport}>
                  <pre className={styles.terminalOutput}>{CLI_HELP_OUTPUT}</pre>
                </ScrollArea>
              </div>
            </ThemeProvider>
          </Block>
        </div>
      </main>
    </div>
  );
});

DownloadsPage.displayName = 'DownloadsPage';

export default DownloadsPage;

'use client';

import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRightIcon,
  BotIcon,
  CircleHelpIcon,
  CircleStopIcon,
  LinkIcon,
  MegaphoneIcon,
  MessageSquarePlusIcon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import type { MessengerPlatform } from '../constants';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    overflow: hidden;
    padding: 0;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};
  `,
  command: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  row: css`
    padding-block: 12px;
    padding-inline: 16px;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  // Mirrors the `rowIcon` treatment of the Connections cards in shared.tsx so
  // the two sections on the detail page read as one visual language.
  rowIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: 8px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
}));

type MessengerCommandName = 'agents' | 'feedback' | 'help' | 'new' | 'start' | 'stop' | 'switch';

/** Display order mirrors the onboarding flow: link first, then routing
 *  (agent / scope), then conversation controls, then meta commands. */
const COMMANDS: { icon: LucideIcon; name: MessengerCommandName }[] = [
  { icon: LinkIcon, name: 'start' },
  { icon: BotIcon, name: 'agents' },
  { icon: ArrowLeftRightIcon, name: 'switch' },
  { icon: MessageSquarePlusIcon, name: 'new' },
  { icon: CircleStopIcon, name: 'stop' },
  { icon: MegaphoneIcon, name: 'feedback' },
  { icon: CircleHelpIcon, name: 'help' },
];

/** Mirrors `WECHAT_UNSUPPORTED_COMMANDS` in the server `MessengerRouter` —
 *  WeChat binds via the web QR flow, so the bot never exposes `/start`. */
const WECHAT_HIDDEN_COMMANDS = new Set<MessengerCommandName>(['start']);

interface CommandsSectionProps {
  platform: MessengerPlatform;
}

/**
 * "Commands" block on every messenger detail page: teaches users the system
 * bot's slash commands (how to link, switch agent / workspace, send feedback)
 * instead of leaving them to discover the commands inside the bot. The list is
 * a static mirror of the server command registry
 * (`MessengerRouter.buildCommands`) because the descriptions need frontend
 * i18n — keep the two in sync when adding a command.
 */
const CommandsSection = memo<CommandsSectionProps>(({ platform }) => {
  const { t } = useTranslation('messenger');
  // Same gate as the workspace scope selector in `UserAgentConnection` —
  // without workspaces, `/switch` has nothing to switch between.
  const enableWorkspaceScopes = useServerConfigStore(
    (s) =>
      serverConfigSelectors.enableBusinessFeatures(s) && s.featureFlags.enableWorkspace === true,
  );

  const commands = COMMANDS.filter(({ name }) => {
    if (platform === 'wechat' && WECHAT_HIDDEN_COMMANDS.has(name)) return false;
    if (name === 'switch' && !enableWorkspaceScopes) return false;
    return true;
  });

  return (
    <Flexbox gap={8}>
      <Flexbox gap={2}>
        <Text strong style={{ fontSize: 15 }}>
          {t('messenger.detail.commands.title')}
        </Text>
        <Text style={{ fontSize: 13 }} type="secondary">
          {t('messenger.detail.commands.hint')}
        </Text>
      </Flexbox>
      <Block className={styles.card}>
        {commands.map(({ icon, name }) => (
          <Flexbox horizontal align="center" className={styles.row} gap={16} key={name}>
            <Flexbox horizontal align="center" flex="none" gap={12}>
              <div className={styles.rowIcon}>
                <Icon icon={icon} size="small" />
              </div>
              <code className={styles.command}>/{name}</code>
            </Flexbox>
            <Text style={{ flex: 1, fontSize: 12, minWidth: 0, textAlign: 'end' }} type="secondary">
              {t(`messenger.detail.commands.${name}` as any)}
            </Text>
          </Flexbox>
        ))}
      </Block>
    </Flexbox>
  );
});
CommandsSection.displayName = 'MessengerCommandsSection';

export default CommandsSection;

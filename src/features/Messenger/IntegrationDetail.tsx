'use client';

import { Block, Button, Flexbox, Icon, Skeleton, Tag, Text } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import {
  ArrowLeftIcon,
  BriefcaseIcon,
  CheckCircle2Icon,
  LinkIcon,
  ServerIcon,
  Trash2Icon,
  UserIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { messengerService } from '@/services/messenger';

import AgentSelect from './AgentSelect';
import { type MessengerPlatform, PlatformAvatar } from './constants';
import { getMessengerErrorMessage } from './i18n';
import LinkModal from './LinkModal';

const styles = createStaticStyles(({ css, cssVar }) => ({
  backButton: css`
    cursor: pointer;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  card: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};
  `,
  emptyRow: css`
    padding-block: 32px;
    padding-inline: 16px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  rowIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: 8px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
}));

interface ConnectionRowProps {
  action?: ReactNode;
  children?: ReactNode;
  icon: ReactNode;
  label: string;
  name: string;
  status: 'connected' | 'pending';
}

const ConnectionRow = memo<ConnectionRowProps>(
  ({ action, children, icon, label, name, status }) => {
    const { t } = useTranslation('messenger');

    return (
      <Flexbox gap={12} style={{ paddingBlock: 12 }}>
        <Flexbox horizontal align="center" gap={12}>
          <div className={styles.rowIcon}>{icon}</div>
          <Flexbox flex={1} gap={2}>
            <Text style={{ fontSize: 12 }} type="secondary">
              {label}
            </Text>
            <Text strong>{name}</Text>
          </Flexbox>
          {status === 'connected' ? (
            <Tag color="success" icon={<Icon icon={CheckCircle2Icon} size="small" />}>
              {t('messenger.detail.connections.connected')}
            </Tag>
          ) : (
            <Tag color="warning">{t('messenger.detail.connections.pending')}</Tag>
          )}
          {action}
        </Flexbox>
        {children && <Flexbox style={{ paddingInlineStart: 48 }}>{children}</Flexbox>}
      </Flexbox>
    );
  },
);
ConnectionRow.displayName = 'MessengerConnectionRow';

const ConnectionsSkeleton = memo<{ withNestedContent?: boolean }>(
  ({ withNestedContent = false }) => (
    <Flexbox gap={12}>
      {Array.from({ length: 2 }).map((_, index) => (
        <Flexbox gap={12} key={index} style={{ paddingBlock: 12 }}>
          <Flexbox horizontal align="center" gap={12}>
            <Skeleton.Avatar active shape={'square'} size={36} />
            <Flexbox flex={1} gap={6}>
              <Skeleton.Button active size={'small'} style={{ width: 56 }} />
              <Skeleton.Button active style={{ height: 18, width: '40%' }} />
            </Flexbox>
            <Skeleton.Button active size={'small'} style={{ width: 72 }} />
            <Skeleton.Button active size={'small'} style={{ width: 84 }} />
          </Flexbox>
          {withNestedContent && (
            <Flexbox gap={6} style={{ paddingInlineStart: 48 }}>
              <Skeleton.Button active size={'small'} style={{ width: 72 }} />
              <Skeleton.Button active style={{ height: 32, width: '100%' }} />
            </Flexbox>
          )}
        </Flexbox>
      ))}
    </Flexbox>
  ),
);
ConnectionsSkeleton.displayName = 'MessengerConnectionsSkeleton';

const IntegrationDetailSkeleton = memo<{ withNestedContent?: boolean }>(
  ({ withNestedContent = false }) => (
    <Flexbox gap={20}>
      <Flexbox horizontal align="center" gap={12}>
        <Skeleton.Button active size={'small'} style={{ width: 20 }} />
        <Skeleton.Button active style={{ height: 28, width: 96 }} />
      </Flexbox>

      <Block className={styles.card}>
        <Flexbox horizontal align="center" gap={16}>
          <Skeleton.Avatar active shape={'square'} size={48} />
          <Flexbox flex={1} gap={6}>
            <Skeleton.Button active size={'small'} style={{ width: 64 }} />
            <Skeleton active paragraph={{ rows: 1, width: '65%' }} title={false} />
          </Flexbox>
          <Skeleton.Button active style={{ height: 40, width: 120 }} />
        </Flexbox>
      </Block>

      <Flexbox gap={8}>
        <Skeleton.Button active size={'small'} style={{ width: 72 }} />
        <Block className={styles.card}>
          <ConnectionsSkeleton withNestedContent={withNestedContent} />
        </Block>
      </Flexbox>
    </Flexbox>
  ),
);
IntegrationDetailSkeleton.displayName = 'MessengerIntegrationDetailSkeleton';

interface IntegrationDetailProps {
  appId?: string;
  botUsername?: string;
  /** Brand-name label (e.g. `"Slack"`) sourced from the registry. */
  name: string;
  onBack: () => void;
  platform: MessengerPlatform;
}

const IntegrationDetail = memo<IntegrationDetailProps>(
  ({ appId, botUsername, name, onBack, platform }) => {
    const { t } = useTranslation('messenger');
    const { message, modal } = App.useApp();
    const [linkOpen, setLinkOpen] = useState(false);

    const linksSWR = useSWR('messenger:listMyLinks', () => messengerService.listMyLinks());
    const installationsSWR = useSWR('messenger:listMyInstallations', () =>
      messengerService.listMyInstallations(),
    );

    const platformLabel = name;
    const allLinks = linksSWR.data ?? [];
    const links = allLinks.filter((l) => l.platform === platform);
    const installations = (installationsSWR.data ?? []).filter((i) => i.platform === platform);
    const tenantNameByTenantId = new Map(installations.map((i) => [i.tenantId, i.tenantName]));
    const isInitialLoading = linksSWR.data === undefined || installationsSWR.data === undefined;

    const handleSetActive = async (tenantId: string, agentId: string | null) => {
      try {
        await messengerService.setActiveAgent({
          agentId,
          platform,
          tenantId: tenantId || undefined,
        });
        await linksSWR.mutate();
        message.success(t('messenger.setActiveSuccess'));
      } catch (error) {
        message.error(getMessengerErrorMessage(error, t, 'messenger.setActiveFailed'));
      }
    };

    const handleUnlink = (tenantId: string) => {
      modal.confirm({
        content: t('messenger.unlinkConfirm', { platform: platformLabel }),
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await messengerService.unlink({ platform, tenantId: tenantId || undefined });
            await linksSWR.mutate();
            message.success(t('messenger.unlinkSuccess'));
          } catch (error) {
            message.error(getMessengerErrorMessage(error, t, 'messenger.unlinkFailed'));
          }
        },
        title: t('messenger.unlinkTitle'),
      });
    };

    // Disconnect an install row. Copy diverges by platform: for Slack the
    // operation actually freezes the workspace's bot (token-gated dispatch);
    // for Discord it only removes the audit entry (the bot stays in the guild
    // until a server admin kicks it — Discord runs on the global env token).
    const disconnectKeys =
      platform === 'discord'
        ? ({
            confirm: 'messenger.discord.connections.disconnectConfirm',
            failed: 'messenger.discord.connections.disconnectFailed',
            success: 'messenger.discord.connections.disconnectSuccess',
            title: 'messenger.discord.connections.disconnectTitle',
          } as const)
        : ({
            confirm: 'messenger.slack.connections.disconnectConfirm',
            failed: 'messenger.slack.connections.disconnectFailed',
            success: 'messenger.slack.connections.disconnectSuccess',
            title: 'messenger.slack.connections.disconnectTitle',
          } as const);
    const handleDisconnectInstallation = (id: string) => {
      modal.confirm({
        content: t(disconnectKeys.confirm),
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await messengerService.uninstallInstallation({ installationId: id });
            await installationsSWR.mutate();
            await linksSWR.mutate();
            message.success(t(disconnectKeys.success));
          } catch (error) {
            message.error(getMessengerErrorMessage(error, t, disconnectKeys.failed));
          }
        },
        title: t(disconnectKeys.title),
      });
    };

    const isSlack = platform === 'slack';
    const isDiscord = platform === 'discord';
    // Slack and Discord both surface per-tenant install rows in the audit list.
    // Slack pairs each workspace install with at most one user link (link
    // dispatch is workspace-token-gated). Discord keeps the install list as
    // pure audit data — the runtime bot uses a global env token, so the user
    // link is a single global row, decoupled from the server installs below it.
    const usesInstallList = isSlack || isDiscord;
    const hasInstallations = installations.length > 0;
    const hasLinks = links.length > 0;

    // Header action — Slack/Discord always lets the user add another tenant
    // (workspace / server); Telegram (the only remaining global-bot platform)
    // toggles between Connect (no link) and Disconnect (linked).
    const addTenantLabel = isDiscord
      ? t('messenger.detail.addServer')
      : t('messenger.detail.addWorkspace');
    const headerAction = usesInstallList ? (
      <Button
        icon={<Icon icon={LinkIcon} />}
        type={hasInstallations ? 'default' : 'primary'}
        onClick={() => setLinkOpen(true)}
      >
        {hasInstallations ? addTenantLabel : t('messenger.linkCta')}
      </Button>
    ) : hasLinks ? (
      <Button danger icon={<Icon icon={Trash2Icon} />} onClick={() => handleUnlink('')}>
        {t('messenger.unlinkCta')}
      </Button>
    ) : (
      <Button icon={<Icon icon={LinkIcon} />} type="primary" onClick={() => setLinkOpen(true)}>
        {t('messenger.linkCta')}
      </Button>
    );

    // Slack: render one workspace row per install + one user row per link.
    // Installs without a matching link are surfaced with `pending` status so the
    // user knows they still need to DM the bot to finish per-account binding.
    const renderSlackConnections = () => {
      const linkByTenantId = new Map(links.map((l) => [l.tenantId, l]));
      return (
        <Flexbox>
          {installations.map((install) => (
            <ConnectionRow
              icon={<Icon icon={BriefcaseIcon} size="small" />}
              key={install.id}
              label={t('messenger.detail.connections.workspaceLabel')}
              name={install.tenantName || install.tenantId}
              status="connected"
              action={
                <Button
                  danger
                  icon={<Icon icon={Trash2Icon} />}
                  size="small"
                  onClick={() => handleDisconnectInstallation(install.id)}
                >
                  {t('messenger.detail.disconnect')}
                </Button>
              }
            />
          ))}
          {links.map((link) => {
            const workspace = tenantNameByTenantId.get(link.tenantId) || link.tenantId;
            const handle = link.platformUsername
              ? `@${link.platformUsername}`
              : `ID ${link.platformUserId}`;
            return (
              <ConnectionRow
                icon={<Icon icon={UserIcon} size="small" />}
                key={link.id}
                label={t('messenger.detail.connections.userLabel')}
                name={`${handle} · ${workspace}`}
                status="connected"
                action={
                  <Button
                    danger
                    icon={<Icon icon={Trash2Icon} />}
                    size="small"
                    onClick={() => handleUnlink(link.tenantId)}
                  >
                    {t('messenger.detail.disconnect')}
                  </Button>
                }
              >
                <Flexbox gap={6}>
                  <Text style={{ fontSize: 12 }} type="secondary">
                    {t('messenger.activeAgent')}
                  </Text>
                  <AgentSelect
                    placeholder={t('messenger.activeAgentPlaceholder')}
                    value={link.activeAgentId ?? undefined}
                    onChange={(agentId) =>
                      handleSetActive(link.tenantId, (agentId ?? null) as string | null)
                    }
                  />
                </Flexbox>
              </ConnectionRow>
            );
          })}
          {/* Installs without any user link yet — gentle nudge to /start in Slack. */}
          {hasInstallations &&
            installations.every((install) => !linkByTenantId.has(install.tenantId)) &&
            !hasLinks && (
              <div className={styles.emptyRow}>{t('messenger.detail.connections.linkHint')}</div>
            )}
        </Flexbox>
      );
    };

    // Discord: a single global user link (Discord uses an env-side bot token,
    // so there's no per-guild link), plus an audit list of server installs.
    // Disconnecting a server row only removes the audit entry — the bot stays
    // in the guild until a server admin kicks it. Disconnect copy
    // (`messenger.discord.connections.*`) makes that distinction explicit.
    const renderDiscordConnections = () => {
      const link = links[0];
      const handle = link
        ? link.platformUsername
          ? `@${link.platformUsername}`
          : `ID ${link.platformUserId}`
        : null;
      return (
        <Flexbox>
          {link && handle && (
            <ConnectionRow
              icon={<Icon icon={UserIcon} size="small" />}
              label={t('messenger.detail.connections.userLabel')}
              name={handle}
              status="connected"
              action={
                <Button
                  danger
                  icon={<Icon icon={Trash2Icon} />}
                  size="small"
                  onClick={() => handleUnlink('')}
                >
                  {t('messenger.detail.disconnect')}
                </Button>
              }
            >
              <Flexbox gap={6}>
                <Text style={{ fontSize: 12 }} type="secondary">
                  {t('messenger.activeAgent')}
                </Text>
                <AgentSelect
                  placeholder={t('messenger.activeAgentPlaceholder')}
                  value={link.activeAgentId ?? undefined}
                  onChange={(agentId) => handleSetActive('', (agentId ?? null) as string | null)}
                />
              </Flexbox>
            </ConnectionRow>
          )}
          {installations.map((install) => (
            <ConnectionRow
              icon={<Icon icon={ServerIcon} size="small" />}
              key={install.id}
              label={t('messenger.detail.connections.serverLabel')}
              name={install.tenantName || install.tenantId}
              status="connected"
              action={
                <Button
                  danger
                  icon={<Icon icon={Trash2Icon} />}
                  size="small"
                  onClick={() => handleDisconnectInstallation(install.id)}
                >
                  {t('messenger.detail.disconnect')}
                </Button>
              }
            />
          ))}
          {!hasLinks && !hasInstallations && (
            <div className={styles.emptyRow}>{t('messenger.detail.connections.empty')}</div>
          )}
        </Flexbox>
      );
    };

    // Generic single-account connection rendering — used by Telegram (the only
    // remaining global-token bot with no install audit list).
    const renderGlobalBotConnections = () => {
      if (!hasLinks) {
        return <div className={styles.emptyRow}>{t('messenger.detail.connections.empty')}</div>;
      }
      const link = links[0];
      const handle = link.platformUsername
        ? `@${link.platformUsername}`
        : `ID ${link.platformUserId}`;
      return (
        <ConnectionRow
          icon={<Icon icon={UserIcon} size="small" />}
          label={t('messenger.detail.connections.userLabel')}
          name={handle}
          status="connected"
          action={
            <Button
              danger
              icon={<Icon icon={Trash2Icon} />}
              size="small"
              onClick={() => handleUnlink('')}
            >
              {t('messenger.detail.disconnect')}
            </Button>
          }
        >
          <Flexbox gap={6}>
            <Text style={{ fontSize: 12 }} type="secondary">
              {t('messenger.activeAgent')}
            </Text>
            <AgentSelect
              placeholder={t('messenger.activeAgentPlaceholder')}
              value={link.activeAgentId ?? undefined}
              onChange={(agentId) => handleSetActive('', (agentId ?? null) as string | null)}
            />
          </Flexbox>
        </ConnectionRow>
      );
    };

    if (isInitialLoading) {
      // Discord shows a user row (with nested AgentSelect) above the server
      // audit list, so it benefits from the nested-content skeleton even
      // though it also surfaces install rows.
      return <IntegrationDetailSkeleton withNestedContent={!isSlack} />;
    }

    return (
      <Flexbox gap={20}>
        <Flexbox horizontal align="center" gap={8}>
          <span className={styles.backButton} onClick={onBack}>
            <Icon icon={ArrowLeftIcon} size="small" />
          </span>
          <Text strong style={{ fontSize: 20 }}>
            {platformLabel}
          </Text>
        </Flexbox>

        <Block className={styles.card}>
          <Flexbox horizontal align="center" gap={16}>
            <PlatformAvatar platform={platform} size={48} />
            <Flexbox flex={1} gap={2}>
              <Text strong style={{ fontSize: 15 }}>
                {platformLabel}
              </Text>
              <Text style={{ fontSize: 13 }} type="secondary">
                {t(`messenger.list.${platform}.description` as any)}
              </Text>
            </Flexbox>
            {headerAction}
          </Flexbox>
        </Block>

        {(hasInstallations || hasLinks) && (
          <Flexbox gap={8}>
            <Text strong style={{ fontSize: 15 }}>
              {t('messenger.detail.connections.title')}
            </Text>
            <Block className={styles.card}>
              {isSlack
                ? renderSlackConnections()
                : isDiscord
                  ? renderDiscordConnections()
                  : renderGlobalBotConnections()}
            </Block>
          </Flexbox>
        )}

        <LinkModal
          appId={appId}
          botUsername={botUsername}
          name={name}
          open={linkOpen}
          platform={platform}
          onClose={() => setLinkOpen(false)}
        />
      </Flexbox>
    );
  },
);

IntegrationDetail.displayName = 'MessengerIntegrationDetail';

export default IntegrationDetail;

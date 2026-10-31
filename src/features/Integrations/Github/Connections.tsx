'use client';

import type { ScmInstallationItem } from '@lobechat/database/schemas';
import { Avatar, Block, Button, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  card: {
    paddingBlock: '2px',
    paddingInline: '16px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  dot: {
    display: 'inline-block',
    flex: 'none',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorSuccess,
    backgroundImage: 'none',
  },
  dotMuted: { backgroundColor: cssVar.colorWarning, backgroundImage: 'none' },
  emptyState: {
    paddingBlock: '24px',
    paddingInline: '20px',
    borderRadius: cssVar.borderRadiusLG,
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  row: {
    paddingBlock: '10px',
    borderBlockEndWidth: { 'default': null, ':not(:last-child)': '1px' },
    borderBlockEndStyle: { 'default': null, ':not(:last-child)': 'solid' },
    borderBlockEndColor: { 'default': null, ':not(:last-child)': cssVar.colorBorderSecondary },
  },
  status: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'inline-flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '4px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadiusSM,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

/** Where GitHub lets the user change repositories or uninstall this installation. */
const manageUrl = (item: ScmInstallationItem) =>
  item.accountType === 'organization'
    ? `https://github.com/organizations/${item.accountLogin}/settings/installations/${item.installationId}`
    : `https://github.com/settings/installations/${item.installationId}`;

interface ConnectionsProps {
  /** False when the deployment has no GitHub App configured; connecting is impossible. */
  configured: boolean;
  installations: ScmInstallationItem[];
  installHref?: string;
  /** Workspace rows say who enabled them; personal rows belong to the viewer. */
  scope: 'personal' | 'workspace';
}

/**
 * Who is connected: every account or organization the App is installed on.
 * Repository changes and uninstalls happen on GitHub, so each row hands off
 * there.
 */
const Connections = memo<ConnectionsProps>(({ configured, installHref, installations, scope }) => {
  const { t } = useTranslation('integration');

  return (
    <Flexbox gap={10}>
      <Flexbox horizontal align="center" gap={16} justify="space-between">
        <Text strong style={{ fontSize: 16 }}>
          {t('github.connections.title')}
        </Text>
        <Button
          disabled={!installHref}
          href={installHref}
          icon={<Icon icon={PlusIcon} />}
          size="small"
          type={installations.length > 0 ? 'default' : 'primary'}
        >
          {t('github.connections.connect')}
        </Button>
      </Flexbox>

      {/* A dead button with no reason beside it is the worst of both. */}
      {configured ? null : (
        <Text style={{ fontSize: 13 }} type="secondary">
          {t('github.connections.notConfigured')}
        </Text>
      )}

      {installations.length === 0 ? (
        <div {...stylex.props(styles.emptyState)}>{t('github.connections.empty')}</div>
      ) : (
        <Block className={stylex.props(styles.card).className} variant={'filled'}>
          {installations.map((item) => {
            const repositories =
              item.repositorySelection === 'all'
                ? t('github.connections.allRepositories')
                : t('github.connections.selectedRepositories', {
                    count: item.repositories.length,
                  });
            const kind =
              item.accountType === 'organization'
                ? t('github.connections.organization')
                : t('github.connections.personal');
            const date = new Date(item.createdAt).toLocaleDateString();
            const detail =
              scope === 'workspace'
                ? `${kind} · ${repositories} · ${t('github.connections.enabledBy', {
                    date,
                    login: item.installedByExternalLogin ?? item.accountLogin,
                  })}`
                : `${kind} · ${repositories} · ${t('github.connections.connectedOn', { date })}`;
            const suspended = Boolean(item.suspendedAt);
            return (
              <Flexbox
                horizontal
                align="center"
                className={stylex.props(styles.row).className}
                gap={12}
                key={item.id}
              >
                <Avatar
                  avatar={item.metadata.accountAvatarUrl ?? undefined}
                  size={36}
                  title={item.accountLogin}
                />
                <Flexbox flex={1} gap={1} style={{ minWidth: 0 }}>
                  <Text strong>{item.accountLogin}</Text>
                  <Text style={{ fontSize: 13 }} type="secondary">
                    {detail}
                  </Text>
                </Flexbox>
                <DropdownMenu
                  placement="bottomRight"
                  items={[
                    {
                      key: 'manage',
                      label: t('github.connections.manageOnGithub'),
                      onClick: () => window.open(manageUrl(item), '_blank', 'noreferrer'),
                    },
                  ]}
                >
                  <span {...stylex.props(styles.status)}>
                    <span {...stylex.props(styles.dot, suspended && styles.dotMuted)} />
                    <Text>
                      {suspended
                        ? t('github.connections.status.suspended')
                        : t('github.connections.status.connected')}
                    </Text>
                    <Icon icon={ChevronDownIcon} size="small" />
                  </span>
                </DropdownMenu>
              </Flexbox>
            );
          })}
        </Block>
      )}
    </Flexbox>
  );
});

Connections.displayName = 'GithubIntegrationConnections';

export default Connections;

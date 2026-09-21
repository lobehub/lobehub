'use client';

import type { ScmInstallationItem } from '@lobechat/database/schemas';
import { Block, Flexbox, Icon } from '@lobehub/ui';
import { Avatar, Button, DropdownMenu, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDownIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding-block: 2px;
    padding-inline: 16px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  dot: css`
    display: inline-block;
    flex: none;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorSuccess};
  `,
  dotMuted: css`
    background: ${cssVar.colorWarning};
  `,
  emptyState: css`
    padding-block: 24px;
    padding-inline: 20px;
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorTextSecondary};
    text-align: center;

    background: ${cssVar.colorFillQuaternary};
  `,
  row: css`
    padding-block: 10px;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  status: css`
    cursor: pointer;
    user-select: none;

    display: inline-flex;
    gap: 8px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

/** Where GitHub lets the user change repositories or uninstall this installation. */
const manageUrl = (item: ScmInstallationItem) =>
  item.accountType === 'organization'
    ? `https://github.com/organizations/${item.accountLogin}/settings/installations/${item.installationId}`
    : `https://github.com/settings/installations/${item.installationId}`;

interface ConnectionsProps {
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
const Connections = memo<ConnectionsProps>(({ installHref, installations, scope }) => {
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

      {installations.length === 0 ? (
        <div className={styles.emptyState}>{t('github.connections.empty')}</div>
      ) : (
        <Block className={styles.card} variant={'filled'}>
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
              <Flexbox horizontal align="center" className={styles.row} gap={12} key={item.id}>
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
                  <span className={styles.status}>
                    <span className={`${styles.dot} ${suspended ? styles.dotMuted : ''}`} />
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

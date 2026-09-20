'use client';

import type { ScmInstallationItem } from '@lobechat/database/schemas';
import { Block, Flexbox, Icon } from '@lobehub/ui';
import { Avatar, Button, DropdownMenu, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding-block: 4px;
    padding-inline: 16px;
    border-radius: ${cssVar.borderRadiusLG};
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
    padding-block: 32px;
    padding-inline: 24px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  row: css`
    padding-block: 14px;

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

/** Where GitHub lists the apps a user has authorized. */
const AUTHORIZATIONS_URL = 'https://github.com/settings/apps/authorizations';

interface ConnectionsProps {
  identity: { avatarUrl: string | null; externalLogin: string } | null;
  installations: ScmInstallationItem[];
  installHref?: string;
}

/**
 * Who is connected: every account or organization the App is installed on,
 * plus the user's own GitHub identity captured during install. Repository
 * changes and uninstalls happen on GitHub, so each row hands off there.
 */
const Connections = memo<ConnectionsProps>(({ identity, installHref, installations }) => {
  const { t } = useTranslation('integration');

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align="center" gap={16} justify="space-between">
        <Text strong style={{ fontSize: 15 }}>
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
        <Block className={styles.card} variant={'outlined'}>
          {installations.map((item) => {
            const repositories =
              item.repositorySelection === 'all'
                ? t('github.connections.allRepositories')
                : t('github.connections.selectedRepositories', {
                    count: item.repositories.length,
                  });
            const suspended = Boolean(item.suspendedAt);
            return (
              <Flexbox horizontal align="center" className={styles.row} gap={14} key={item.id}>
                <Avatar
                  avatar={item.metadata.accountAvatarUrl ?? undefined}
                  size={40}
                  title={item.accountLogin}
                />
                <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                  <Text strong>{item.accountLogin}</Text>
                  <Text style={{ fontSize: 13 }} type="secondary">
                    {t('github.connections.enabledBy', {
                      date: new Date(item.createdAt).toLocaleDateString(),
                      login: item.installedByExternalLogin ?? '—',
                    })}
                  </Text>
                  <Text style={{ fontSize: 13 }} type="secondary">
                    {item.accountType === 'organization'
                      ? t('github.connections.organization')
                      : t('github.connections.personal')}{' '}
                    · {repositories}
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

      <Block className={styles.card} variant={'outlined'}>
        <Flexbox horizontal align="center" className={styles.row} gap={14}>
          <Flexbox flex={1} gap={2}>
            <Text strong>{t('github.connections.personalAccount.title')}</Text>
            <Text style={{ fontSize: 13 }} type="secondary">
              {identity
                ? t('github.connections.personalAccount.connectedAs', {
                    login: identity.externalLogin,
                  })
                : t('github.connections.personalAccount.notConnected')}
            </Text>
          </Flexbox>
          {identity ? (
            <a href={AUTHORIZATIONS_URL} rel="noreferrer" target="_blank">
              <Flexbox horizontal align="center" gap={4}>
                <Text>{t('github.connections.personalAccount.manage')}</Text>
                <Icon icon={ChevronRightIcon} size="small" />
              </Flexbox>
            </a>
          ) : (
            <Button disabled={!installHref} href={installHref} size="small">
              {t('github.connections.personalAccount.connect')}
            </Button>
          )}
        </Flexbox>
      </Block>
    </Flexbox>
  );
});

Connections.displayName = 'GithubIntegrationConnections';

export default Connections;

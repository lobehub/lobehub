'use client';

import type { LinearConnectionView } from '@lobechat/types';
import {
  Avatar,
  Block,
  Button,
  confirmModal,
  createStaticStyles,
  DropdownMenu,
  Flexbox,
  Icon,
  Text,
  toast,
} from '@lobehub/ui';
import { ChevronDownIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { linearService } from '@/services/linear';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding-block: 12px;
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
  emptyState: css`
    padding-block: 24px;
    padding-inline: 20px;
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorTextSecondary};
    text-align: center;

    background: ${cssVar.colorFillQuaternary};
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

interface ConnectionsProps {
  /** False when the deployment has no Linear OAuth application; connecting is impossible. */
  configured: boolean;
  connections: LinearConnectionView[];
  installHref?: string;
  onChanged: () => void;
  /** Workspace rows say who connected them; personal rows belong to the viewer. */
  scope: 'personal' | 'workspace';
}

/** Every Linear workspace connected in this scope. */
const Connections = memo<ConnectionsProps>(
  ({ configured, connections, installHref, onChanged, scope }) => {
    const { t } = useTranslation('integration');

    const disconnect = (connection: LinearConnectionView) => {
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('linear.disconnect.content', { account: connection.organizationName }),
        okButtonProps: { danger: true },
        okText: t('linear.disconnect.confirm'),
        onOk: async () => {
          try {
            await linearService.disconnect(connection.id);
            toast.success(t('linear.disconnect.success'));
            onChanged();
          } catch {
            toast.error(t('linear.disconnect.failed'));
          }
        },
        title: t('linear.disconnect.title'),
      });
    };

    return (
      <Flexbox gap={10}>
        <Flexbox horizontal align="center" gap={16} justify="space-between">
          <Text strong style={{ fontSize: 16 }}>
            {t('linear.connections.title')}
          </Text>
          <Button
            disabled={!installHref}
            href={installHref}
            icon={<Icon icon={PlusIcon} />}
            size="small"
            type={connections.length > 0 ? 'default' : 'primary'}
          >
            {t('linear.connections.connect')}
          </Button>
        </Flexbox>

        {configured ? null : (
          <Text style={{ fontSize: 13 }} type="secondary">
            {t('linear.connections.notConfigured')}
          </Text>
        )}

        {connections.length > 0 && (
          <Text style={{ fontSize: 13 }} type="secondary">
            {t('linear.sync.projectHint')}
          </Text>
        )}

        {connections.length === 0 ? (
          <div className={styles.emptyState}>{t('linear.connections.empty')}</div>
        ) : (
          connections.map((connection) => {
            const date = new Date(connection.createdAt).toLocaleDateString();
            const detail =
              scope === 'workspace'
                ? t('linear.connections.enabledBy', { date, name: connection.actorName })
                : t('linear.connections.connectedAs', { date, name: connection.actorName });
            return (
              <Block className={styles.card} key={connection.id} variant={'filled'}>
                <Flexbox horizontal align="center" gap={12}>
                  <Avatar
                    avatar={connection.metadata.organizationLogoUrl ?? undefined}
                    size={36}
                    title={connection.organizationName}
                  />
                  <Flexbox flex={1} gap={1} style={{ minWidth: 0 }}>
                    <Text strong>{connection.organizationName}</Text>
                    <Text style={{ fontSize: 13 }} type="secondary">
                      {detail}
                    </Text>
                  </Flexbox>
                  <DropdownMenu
                    placement="bottomRight"
                    items={[
                      {
                        key: 'open',
                        label: t('linear.connections.openInLinear'),
                        onClick: () =>
                          window.open(
                            `https://linear.app/${connection.organizationUrlKey}`,
                            '_blank',
                            'noreferrer',
                          ),
                      },
                      {
                        danger: true,
                        key: 'disconnect',
                        label: t('linear.disconnect.confirm'),
                        onClick: () => disconnect(connection),
                      },
                    ]}
                  >
                    <span className={styles.status}>
                      <span className={styles.dot} />
                      <Text>{t('linear.connections.status.connected')}</Text>
                      <Icon icon={ChevronDownIcon} size="small" />
                    </span>
                  </DropdownMenu>
                </Flexbox>
              </Block>
            );
          })
        )}
      </Flexbox>
    );
  },
);

Connections.displayName = 'LinearIntegrationConnections';

export default Connections;

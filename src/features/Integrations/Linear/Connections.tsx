'use client';

import type { LinearConnectionView } from '@lobechat/types';
import {
  Avatar,
  Block,
  Button,
  confirmModal,
  DropdownMenu,
  Flexbox,
  Icon,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { linearService } from '@/services/linear';

const styles = stylex.create({
  card: {
    paddingBlock: '12px',
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
  emptyState: {
    paddingBlock: '24px',
    paddingInline: '20px',
    borderRadius: cssVar.borderRadiusLG,
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
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
          <div {...stylex.props(styles.emptyState)}>{t('linear.connections.empty')}</div>
        ) : (
          connections.map((connection) => {
            const date = new Date(connection.createdAt).toLocaleDateString();
            const detail =
              scope === 'workspace'
                ? t('linear.connections.enabledBy', { date, name: connection.actorName })
                : t('linear.connections.connectedAs', { date, name: connection.actorName });
            return (
              <Block
                className={stylex.props(styles.card).className}
                key={connection.id}
                variant={'filled'}
              >
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
                    <span {...stylex.props(styles.status)}>
                      <span {...stylex.props(styles.dot)} />
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

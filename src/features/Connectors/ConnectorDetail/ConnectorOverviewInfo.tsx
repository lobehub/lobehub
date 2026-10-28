import { getComposioAppByIdentifier, getLobehubSkillProviderById } from '@lobechat/const';
import { Avatar, Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ConnectorSourceType, ConnectorStatus } from '@/database/schemas';
import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

const styles = stylex.create({
  label: {
    color: cssVar.colorTextTertiary,
    flexShrink: 0,
    fontSize: 13,
    width: 96,
  },
  list: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    paddingBlock: 4,
    paddingInline: 12,
  },
  row: {
    borderBlockEndColor: {
      ':last-child': 'transparent',
      'default': cssVar.colorBorderSecondary,
    },
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    minHeight: 40,
  },
});

type ConnectorKind = 'agent' | 'builtin' | 'community' | 'custom' | 'oauth';

export const getConnectorKind = (
  connector: Pick<ConnectorWithTools, 'agentId' | 'identifier' | 'sourceType'>,
): ConnectorKind => {
  if (connector.agentId) return 'agent';
  if (connector.sourceType === ConnectorSourceType.builtin) return 'builtin';
  if (connector.sourceType === ConnectorSourceType.custom) return 'custom';
  // Marketplace rows also back plain community plugins; only Composio / LobeHub
  // providers authorize through OAuth.
  const isOAuth =
    !!getComposioAppByIdentifier(connector.identifier) ||
    !!getLobehubSkillProviderById(connector.identifier);
  return isOAuth ? 'oauth' : 'community';
};

const Row = ({ children, label }: { children: ReactNode; label: string }) => (
  <Flexbox horizontal align={'center'} gap={12} {...stylex.props(styles.row)}>
    <span {...stylex.props(styles.label)}>{label}</span>
    <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
      {children}
    </Flexbox>
  </Flexbox>
);

interface ConnectorOverviewInfoProps {
  connector: ConnectorWithTools;
}

/**
 * Overview facts of a connector: whether it is authorized and who authorized
 * it. The kind of object sits under the page title; tool permissions live in
 * the Tools tab.
 */
const ConnectorOverviewInfo = memo<ConnectorOverviewInfoProps>(({ connector }) => {
  const { t } = useTranslation('tool');

  const kind = getConnectorKind(connector);
  const isBuiltin = kind === 'builtin';
  // Uninstalling a built-in only records it in a user preference; the connector
  // row stays, so read the same installation state the list shows.
  const isBuiltinInstalled = useToolStore(
    builtinToolSelectors.isBuiltinToolInstalled(connector.identifier),
  );
  const status = isBuiltin
    ? isBuiltinInstalled
      ? { color: 'success' as const, label: t('connector.enabled') }
      : { label: t('tools.builtins.uninstalled', { ns: 'setting' }) }
    : // Disconnect only clears `isEnabled` and leaves the stored status (connected
      // or error) behind, so a disabled connector reads not connected first.
      !connector.isEnabled
      ? { label: t('connector.notConnected') }
      : connector.status === ConnectorStatus.connected
        ? { color: 'success' as const, label: t('connector.connected') }
        : connector.status === ConnectorStatus.error
          ? { color: 'error' as const, label: t('connector.authError') }
          : { label: t('connector.notConnected') };

  return (
    <div {...stylex.props(styles.list)}>
      <Row label={t('connector.overview.status')}>
        <Tag color={status.color}>{status.label}</Tag>
      </Row>
      {connector.authorizedByName && (
        <Row label={t('connector.overview.authorizedBy')}>
          {connector.authorizedByAvatar && (
            <Avatar avatar={connector.authorizedByAvatar} shape={'circle'} size={20} />
          )}
          <Text ellipsis>{connector.authorizedByName}</Text>
        </Row>
      )}
    </div>
  );
});

ConnectorOverviewInfo.displayName = 'ConnectorOverviewInfo';

export default ConnectorOverviewInfo;

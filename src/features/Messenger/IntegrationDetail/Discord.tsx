'use client';

import { Button, Icon, Text } from '@lobehub/ui';
import { LinkIcon, ServerIcon, Trash2Icon, UserIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { usePermission } from '@/hooks/usePermission';

import { buildDiscordOpenBotUrl } from '../constants';
import { createMessengerLinkModal } from '../LinkModal';
import {
  ConnectionRow,
  DetailLayout,
  IntegrationDetailSkeleton,
  styles,
  useDisconnectInstallation,
  useLinkActions,
  useMessengerData,
  UserAgentConnection,
} from './shared';

interface DiscordDetailProps {
  appId?: string;
  botUsername?: string;
  name: string;
  onBack: () => void;
}

// Discord: a single global user link (Discord uses an env-side bot token, so
// there's no per-guild link), plus an audit list of server installs.
// Disconnecting only removes the audit entry — the bot stays in the guild
// until a server admin kicks it. Disconnect copy
// (`messenger.discord.connections.*`) makes that distinction explicit.
const DiscordDetail = memo<DiscordDetailProps>(({ appId, botUsername, name, onBack }) => {
  const { t } = useTranslation('messenger');
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

  const data = useMessengerData('discord');
  const { handleSetActive, handleUnlink } = useLinkActions({
    installationsMutate: data.installationsMutate,
    linksMutate: data.linksMutate,
    name,
    platform: 'discord',
  });
  const disconnectInstallation = useDisconnectInstallation({
    installationsMutate: data.installationsMutate,
    linksMutate: data.linksMutate,
  });

  const handleDisconnectInstallation = (id: string) =>
    canEdit &&
    disconnectInstallation(id, {
      confirm: t('messenger.discord.connections.disconnectConfirm'),
      failedKey: 'messenger.discord.connections.disconnectFailed',
      success: t('messenger.discord.connections.disconnectSuccess'),
      title: t('messenger.discord.connections.disconnectTitle'),
    });

  if (data.error && data.isInitialLoading)
    return <AsyncError error={data.error} variant={'block'} onRetry={data.mutate} />;
  if (data.isInitialLoading) return <IntegrationDetailSkeleton withNestedContent />;

  const { installations, links } = data;
  const hasInstallations = installations.length > 0;
  const hasLinks = links.length > 0;
  const link = links[0];

  const handleOpenLink = () =>
    createMessengerLinkModal({ appId, botUsername, name, platform: 'discord' });

  const headerAction = (
    <Button
      disabled={!canCreate || !canEdit}
      icon={<Icon icon={LinkIcon} />}
      type={hasInstallations ? 'default' : 'primary'}
      onClick={handleOpenLink}
    >
      {hasInstallations ? t('messenger.detail.addServer') : t('messenger.linkCta')}
    </Button>
  );

  return (
    <DetailLayout
      hasConnections={hasInstallations || hasLinks}
      headerAction={headerAction}
      name={name}
      platform="discord"
      onBack={onBack}
    >
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
      {link ? (
        <UserAgentConnection
          link={link}
          onSetActive={(agentId) => handleSetActive('', agentId)}
          onUnlink={() => handleUnlink('')}
        />
      ) : (
        hasInstallations &&
        appId && (
          <ConnectionRow
            icon={<Icon icon={UserIcon} size="small" />}
            label={t('messenger.detail.connections.userLabel')}
            name={t('messenger.discord.userPending.name')}
            status="pending"
            action={
              <Button
                disabled={!canCreate || !canEdit}
                href={buildDiscordOpenBotUrl(appId)}
                icon={<Icon icon={LinkIcon} />}
                size="small"
                target="_blank"
                type="primary"
              >
                {t('messenger.discord.userPending.cta')}
              </Button>
            }
          >
            <Text style={{ fontSize: 12 }} type="secondary">
              {t('messenger.discord.userPending.hint')}
            </Text>
          </ConnectionRow>
        )
      )}
      {!hasLinks && !hasInstallations && (
        <div className={styles.emptyRow}>{t('messenger.detail.connections.empty')}</div>
      )}
    </DetailLayout>
  );
});

DiscordDetail.displayName = 'MessengerDiscordDetail';

export default DiscordDetail;

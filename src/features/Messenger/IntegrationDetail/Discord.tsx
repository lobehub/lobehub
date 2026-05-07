'use client';

import { Button, Flexbox, Icon } from '@lobehub/ui';
import { App } from 'antd';
import { LinkIcon, ServerIcon, Trash2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { messengerService } from '@/services/messenger';

import { getMessengerErrorMessage } from '../i18n';
import LinkModal from '../LinkModal';
import {
  ConnectionRow,
  DetailLayout,
  IntegrationDetailSkeleton,
  styles,
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
const DiscordDetail = memo<DiscordDetailProps>(({ appId, botUsername, name, onBack }) => {
  const { t } = useTranslation('messenger');
  const { message, modal } = App.useApp();
  const [linkOpen, setLinkOpen] = useState(false);

  const data = useMessengerData('discord');
  const { handleSetActive, handleUnlink } = useLinkActions({
    installationsMutate: data.installationsMutate,
    linksMutate: data.linksMutate,
    name,
    platform: 'discord',
  });

  // For Discord, disconnecting only removes the audit entry — the bot stays in
  // the guild until a server admin kicks it (Discord uses an env-side bot
  // token, decoupled from per-install state). The `disconnect*` copy strings
  // call this distinction out so the user isn't surprised by the bot
  // remaining in the server list.
  const handleDisconnectInstallation = (id: string) => {
    modal.confirm({
      content: t('messenger.discord.connections.disconnectConfirm'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await messengerService.uninstallInstallation({ installationId: id });
          await data.installationsMutate();
          await data.linksMutate();
          message.success(t('messenger.discord.connections.disconnectSuccess'));
        } catch (error) {
          message.error(
            getMessengerErrorMessage(error, t, 'messenger.discord.connections.disconnectFailed'),
          );
        }
      },
      title: t('messenger.discord.connections.disconnectTitle'),
    });
  };

  if (data.isInitialLoading) return <IntegrationDetailSkeleton withNestedContent />;

  const { installations, links } = data;
  const hasInstallations = installations.length > 0;
  const hasLinks = links.length > 0;
  const link = links[0];

  const headerAction = (
    <Button
      icon={<Icon icon={LinkIcon} />}
      type={hasInstallations ? 'default' : 'primary'}
      onClick={() => setLinkOpen(true)}
    >
      {hasInstallations ? t('messenger.detail.addServer') : t('messenger.linkCta')}
    </Button>
  );

  return (
    <>
      <DetailLayout
        hasConnections={hasInstallations || hasLinks}
        headerAction={headerAction}
        name={name}
        platform="discord"
        onBack={onBack}
      >
        <Flexbox>
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
          {link && (
            <UserAgentConnection
              link={link}
              onSetActive={(agentId) => handleSetActive('', agentId)}
              onUnlink={() => handleUnlink('')}
            />
          )}
          {!hasLinks && !hasInstallations && (
            <div className={styles.emptyRow}>{t('messenger.detail.connections.empty')}</div>
          )}
        </Flexbox>
      </DetailLayout>

      <LinkModal
        appId={appId}
        botUsername={botUsername}
        name={name}
        open={linkOpen}
        platform="discord"
        onClose={() => setLinkOpen(false)}
      />
    </>
  );
});

DiscordDetail.displayName = 'MessengerDiscordDetail';

export default DiscordDetail;

'use client';

import { Button, Icon } from '@lobehub/ui';
import { BriefcaseIcon, LinkIcon, Trash2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import LinkModal from '../LinkModal';
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

interface SlackDetailProps {
  appId?: string;
  botUsername?: string;
  name: string;
  onBack: () => void;
}

const SlackDetail = memo<SlackDetailProps>(({ appId, botUsername, name, onBack }) => {
  const { t } = useTranslation('messenger');
  const [linkOpen, setLinkOpen] = useState(false);

  const data = useMessengerData('slack');
  const { handleSetActive, handleUnlink } = useLinkActions({
    installationsMutate: data.installationsMutate,
    linksMutate: data.linksMutate,
    name,
    platform: 'slack',
  });
  const disconnectInstallation = useDisconnectInstallation({
    installationsMutate: data.installationsMutate,
    linksMutate: data.linksMutate,
  });

  // For Slack, disconnecting an install row freezes the workspace's bot —
  // dispatch is token-gated, so removing the install effectively kills the
  // workspace integration even though the bot user remains in Slack.
  const handleDisconnectInstallation = (id: string) =>
    disconnectInstallation(id, {
      confirm: t('messenger.slack.connections.disconnectConfirm'),
      failedKey: 'messenger.slack.connections.disconnectFailed',
      success: t('messenger.slack.connections.disconnectSuccess'),
      title: t('messenger.slack.connections.disconnectTitle'),
    });

  if (data.isInitialLoading) return <IntegrationDetailSkeleton />;

  const { installations, links, tenantNameByTenantId } = data;
  const hasInstallations = installations.length > 0;
  const hasLinks = links.length > 0;

  const headerAction = (
    <Button
      icon={<Icon icon={LinkIcon} />}
      type={hasInstallations ? 'default' : 'primary'}
      onClick={() => setLinkOpen(true)}
    >
      {hasInstallations ? t('messenger.detail.addWorkspace') : t('messenger.linkCta')}
    </Button>
  );

  // Slack: render one workspace row per install + one user row per link.
  // Installs without a matching link are surfaced with `pending` status so the
  // user knows they still need to DM the bot to finish per-account binding.
  const linkByTenantId = new Map(links.map((l) => [l.tenantId, l]));
  const allInstallsUnlinked =
    hasInstallations && installations.every((install) => !linkByTenantId.has(install.tenantId));

  return (
    <>
      <DetailLayout
        hasConnections={hasInstallations || hasLinks}
        headerAction={headerAction}
        name={name}
        platform="slack"
        onBack={onBack}
      >
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
          return (
            <UserAgentConnection
              extraLabel={workspace}
              key={link.id}
              link={link}
              onSetActive={(agentId) => handleSetActive(link.tenantId, agentId)}
              onUnlink={() => handleUnlink(link.tenantId)}
            />
          );
        })}
        {/* Installs without any user link yet — gentle nudge to /start in Slack. */}
        {allInstallsUnlinked && !hasLinks && (
          <div className={styles.emptyRow}>{t('messenger.detail.connections.linkHint')}</div>
        )}
      </DetailLayout>

      <LinkModal
        appId={appId}
        botUsername={botUsername}
        name={name}
        open={linkOpen}
        platform="slack"
        onClose={() => setLinkOpen(false)}
      />
    </>
  );
});

SlackDetail.displayName = 'MessengerSlackDetail';

export default SlackDetail;

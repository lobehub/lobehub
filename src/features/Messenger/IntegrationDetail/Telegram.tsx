'use client';

import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { LinkIcon, Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { usePermission } from '@/hooks/usePermission';

import { createMessengerLinkModal } from '../LinkModal';
import {
  DetailLayout,
  IntegrationDetailSkeleton,
  styles,
  useLinkActions,
  useMessengerData,
  UserAgentConnection,
} from './shared';

interface TelegramDetailProps {
  appId?: string;
  botUsername?: string;
  name: string;
  onBack: () => void;
}

// Telegram is the only remaining global-token bot with no install audit list,
// so it's a single global user link with a connect/disconnect toggle in the
// header.
const TelegramDetail = memo<TelegramDetailProps>(({ appId, botUsername, name, onBack }) => {
  const { t } = useTranslation('messenger');
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

  const data = useMessengerData('telegram');
  const { handleSetActive, handleUnlink } = useLinkActions({
    installationsMutate: data.installationsMutate,
    linksMutate: data.linksMutate,
    name,
    platform: 'telegram',
  });

  if (data.error && data.isInitialLoading)
    return <AsyncError error={data.error} variant={'block'} onRetry={data.mutate} />;
  if (data.isInitialLoading) return <IntegrationDetailSkeleton withNestedContent />;

  const { links } = data;
  const hasLinks = links.length > 0;
  const link = links[0];

  const handleOpenLink = () =>
    createMessengerLinkModal({ appId, botUsername, name, platform: 'telegram' });

  const headerAction = hasLinks ? (
    <Button
      danger
      disabled={!canEdit}
      icon={<Icon icon={Trash2Icon} />}
      onClick={() => {
        if (!canEdit) return;
        handleUnlink('');
      }}
    >
      {t('messenger.unlinkCta')}
    </Button>
  ) : (
    <Button
      disabled={!canCreate || !canEdit}
      icon={<Icon icon={LinkIcon} />}
      type="primary"
      onClick={handleOpenLink}
    >
      {t('messenger.linkCta')}
    </Button>
  );

  return (
    <DetailLayout
      hasConnections={hasLinks}
      headerAction={headerAction}
      name={name}
      platform="telegram"
      onBack={onBack}
    >
      {link ? (
        <UserAgentConnection
          link={link}
          onSetActive={(agentId) => handleSetActive('', agentId)}
          onUnlink={() => handleUnlink('')}
        />
      ) : (
        <div className={styles.emptyRow}>{t('messenger.detail.connections.empty')}</div>
      )}
    </DetailLayout>
  );
});

TelegramDetail.displayName = 'MessengerTelegramDetail';

export default TelegramDetail;

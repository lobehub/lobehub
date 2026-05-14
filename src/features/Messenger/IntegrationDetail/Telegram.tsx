'use client';

import { Button, Icon } from '@lobehub/ui';
import { LinkIcon, Trash2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import LinkModal from '../LinkModal';
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
  const [linkOpen, setLinkOpen] = useState(false);

  const data = useMessengerData('telegram');
  const { handleSetActive, handleUnlink } = useLinkActions({
    installationsMutate: data.installationsMutate,
    linksMutate: data.linksMutate,
    name,
    platform: 'telegram',
  });

  if (data.isInitialLoading) return <IntegrationDetailSkeleton withNestedContent />;

  const { links } = data;
  const hasLinks = links.length > 0;
  const link = links[0];

  const headerAction = hasLinks ? (
    <Button danger icon={<Icon icon={Trash2Icon} />} onClick={() => handleUnlink('')}>
      {t('messenger.unlinkCta')}
    </Button>
  ) : (
    <Button icon={<Icon icon={LinkIcon} />} type="primary" onClick={() => setLinkOpen(true)}>
      {t('messenger.linkCta')}
    </Button>
  );

  return (
    <>
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

      <LinkModal
        appId={appId}
        botUsername={botUsername}
        name={name}
        open={linkOpen}
        platform="telegram"
        onClose={() => setLinkOpen(false)}
      />
    </>
  );
});

TelegramDetail.displayName = 'MessengerTelegramDetail';

export default TelegramDetail;

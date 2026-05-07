'use client';

import { Flexbox, Modal } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { MessengerPlatform } from '../constants';
import DiscordLinkBody from './Discord';
import SlackLinkBody from './Slack';
import TelegramLinkBody from './Telegram';

interface LinkModalProps {
  appId?: string;
  botUsername?: string;
  /** Brand-name label (e.g. `"Slack"`) sourced from the registry. */
  name: string;
  onClose: () => void;
  open: boolean;
  platform: MessengerPlatform;
}

const LinkModal = memo<LinkModalProps>(({ appId, botUsername, name, onClose, open, platform }) => {
  const { t } = useTranslation('messenger');

  const renderBody = () => {
    switch (platform) {
      case 'slack': {
        return <SlackLinkBody />;
      }
      case 'discord': {
        return <DiscordLinkBody appId={appId} name={name} />;
      }
      case 'telegram': {
        return <TelegramLinkBody botUsername={botUsername} name={name} />;
      }
    }
  };

  return (
    <Modal
      footer={null}
      open={open}
      title={t('messenger.linkModal.title')}
      width={480}
      onCancel={onClose}
    >
      <Flexbox align="center" gap={20} style={{ paddingBlock: 16 }}>
        {renderBody()}
      </Flexbox>
    </Modal>
  );
});

LinkModal.displayName = 'MessengerLinkModal';

export default LinkModal;

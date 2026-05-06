'use client';

import { Button, Flexbox, Icon, Modal, Text } from '@lobehub/ui';
import { QRCode } from 'antd';
import { createStaticStyles } from 'antd-style';
import { LinkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildDiscordInviteUrl,
  buildDiscordOpenBotUrl,
  buildTelegramDeepLink,
  type MessengerPlatform,
  PlatformAvatar,
} from './constants';

const styles = createStaticStyles(({ css, cssVar }) => ({
  qrIconOverlay: css`
    pointer-events: none;

    position: absolute;
    z-index: 1;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);

    border: 3px solid ${cssVar.colorBgContainer};
    border-radius: 50%;

    line-height: 0;
  `,
  qrWrap: css`
    position: relative;

    padding: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};
  `,
}));

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
  const platformLabel = name;
  const isSlack = platform === 'slack';
  const isDiscord = platform === 'discord';
  const isTelegram = platform === 'telegram';
  const telegramDeepLink =
    isTelegram && botUsername ? buildTelegramDeepLink(botUsername) : undefined;
  const discordInviteUrl = isDiscord && appId ? buildDiscordInviteUrl(appId) : undefined;
  const discordOpenBotUrl = isDiscord && appId ? buildDiscordOpenBotUrl(appId) : undefined;

  const renderBody = () => {
    if (isSlack) {
      return (
        <>
          <PlatformAvatar platform={platform} size={64} />
          <Flexbox align="center" gap={6}>
            <Text strong style={{ fontSize: 18 }}>
              {t('messenger.slack.connectModal.title')}
            </Text>
            <Text style={{ textAlign: 'center' }} type="secondary">
              {t('messenger.slack.connectModal.description')}
            </Text>
          </Flexbox>
          <Button
            block
            href="/api/agent/messenger/slack/install"
            size="large"
            target="_blank"
            type="primary"
          >
            {t('messenger.slack.connectModal.continueButton')}
          </Button>
        </>
      );
    }

    if (isDiscord) {
      if (!discordInviteUrl) {
        return (
          <>
            <Icon icon={LinkIcon} size={36} />
            <Text strong>{t('messenger.linkModal.continueIn', { platform: platformLabel })}</Text>
            <Text type="warning">{t('messenger.discord.connectModal.notConfigured')}</Text>
          </>
        );
      }
      return (
        <>
          <PlatformAvatar platform={platform} size={64} />
          <Flexbox align="center" gap={6}>
            <Text strong style={{ fontSize: 18 }}>
              {t('messenger.discord.connectModal.title')}
            </Text>
            <Text style={{ textAlign: 'center' }} type="secondary">
              {t('messenger.discord.connectModal.description')}
            </Text>
          </Flexbox>
          <Button block href={discordInviteUrl} size="large" target="_blank" type="primary">
            {t('messenger.discord.connectModal.inviteButton')}
          </Button>
          {discordOpenBotUrl && (
            <Button block href={discordOpenBotUrl} size="large" target="_blank">
              {t('messenger.discord.connectModal.continueButton')}
            </Button>
          )}
        </>
      );
    }

    if (telegramDeepLink) {
      return (
        <>
          <div className={styles.qrWrap}>
            <QRCode bordered={false} size={200} value={telegramDeepLink} />
            <div className={styles.qrIconOverlay}>
              <PlatformAvatar platform={platform} size={44} />
            </div>
          </div>
          <Flexbox align="center" gap={6}>
            <Text strong style={{ fontSize: 18 }}>
              {t('messenger.linkModal.continueIn', { platform: platformLabel })}
            </Text>
            <Text style={{ textAlign: 'center' }} type="secondary">
              {t('messenger.linkModal.scanHint', { platform: platformLabel })}
            </Text>
          </Flexbox>
          <Button block href={telegramDeepLink} size="large" target="_blank" type="primary">
            {t('messenger.linkModal.openCta', { platform: platformLabel })}
          </Button>
        </>
      );
    }

    return (
      <>
        <Icon icon={LinkIcon} size={36} />
        <Text strong>{t('messenger.linkModal.continueIn', { platform: platformLabel })}</Text>
        <Text type="warning">{t('messenger.linkModal.notConfigured')}</Text>
      </>
    );
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

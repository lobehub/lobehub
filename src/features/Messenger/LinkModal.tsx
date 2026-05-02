'use client';

import { Button, Flexbox, Icon, Modal, Text } from '@lobehub/ui';
import { QRCode } from 'antd';
import { createStaticStyles } from 'antd-style';
import { LinkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildTelegramDeepLink,
  type MessengerPlatform,
  PLATFORM_LABELS,
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
  botUsername?: string;
  onClose: () => void;
  open: boolean;
  platform: MessengerPlatform;
}

const LinkModal = memo<LinkModalProps>(({ botUsername, onClose, open, platform }) => {
  const { t } = useTranslation('messenger');
  const platformLabel = PLATFORM_LABELS[platform];
  const isSlack = platform === 'slack';
  const deepLink = !isSlack && botUsername ? buildTelegramDeepLink(botUsername) : undefined;

  return (
    <Modal footer={null} open={open} title={t('messenger.linkModal.title')} onCancel={onClose}>
      <Flexbox align="center" gap={20} style={{ paddingBlock: 16 }}>
        {isSlack ? (
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
        ) : deepLink ? (
          <>
            <div className={styles.qrWrap}>
              <QRCode bordered={false} size={200} value={deepLink} />
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
            <Button block href={deepLink} size="large" target="_blank" type="primary">
              {t('messenger.linkModal.openCta', { platform: platformLabel })}
            </Button>
          </>
        ) : (
          <>
            <Icon icon={LinkIcon} size={36} />
            <Text strong>{t('messenger.linkModal.continueIn', { platform: platformLabel })}</Text>
            <Text type="warning">{t('messenger.linkModal.notConfigured')}</Text>
          </>
        )}
      </Flexbox>
    </Modal>
  );
});

LinkModal.displayName = 'MessengerLinkModal';

export default LinkModal;

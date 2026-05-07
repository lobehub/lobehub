'use client';

import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { QRCode } from 'antd';
import { createStaticStyles } from 'antd-style';
import { LinkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { buildTelegramDeepLink, PlatformAvatar } from '../constants';

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

interface TelegramLinkBodyProps {
  botUsername?: string;
  /** Brand-name label (e.g. `"Telegram"`) sourced from the registry. */
  name: string;
}

const TelegramLinkBody = memo<TelegramLinkBodyProps>(({ botUsername, name }) => {
  const { t } = useTranslation('messenger');

  if (!botUsername) {
    return (
      <>
        <Icon icon={LinkIcon} size={36} />
        <Text strong>{t('messenger.linkModal.continueIn', { platform: name })}</Text>
        <Text type="warning">{t('messenger.linkModal.notConfigured')}</Text>
      </>
    );
  }

  const deepLink = buildTelegramDeepLink(botUsername);

  return (
    <>
      <div className={styles.qrWrap}>
        <QRCode bordered={false} size={200} value={deepLink} />
        <div className={styles.qrIconOverlay}>
          <PlatformAvatar platform="telegram" size={44} />
        </div>
      </div>
      <Flexbox align="center" gap={6}>
        <Text strong style={{ fontSize: 18 }}>
          {t('messenger.linkModal.continueIn', { platform: name })}
        </Text>
        <Text style={{ textAlign: 'center' }} type="secondary">
          {t('messenger.linkModal.scanHint', { platform: name })}
        </Text>
      </Flexbox>
      <Button block href={deepLink} size="large" target="_blank" type="primary">
        {t('messenger.linkModal.openCta', { platform: name })}
      </Button>
    </>
  );
});

TelegramLinkBody.displayName = 'MessengerTelegramLinkBody';

export default TelegramLinkBody;

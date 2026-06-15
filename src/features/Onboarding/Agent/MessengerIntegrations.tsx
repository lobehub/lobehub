'use client';

import { Button, Flexbox, Popover, Skeleton, Text } from '@lobehub/ui';
import { Discord, Slack, Telegram } from '@lobehub/ui/icons';
import { Divider, QRCode } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { buildTelegramDeepLink, PlatformAvatar } from '@/features/Messenger/constants';
import { messengerKeys } from '@/libs/swr/keys';
import { messengerService } from '@/services/messenger';

const SLACK_INSTALL_HREF = '/api/agent/messenger/slack/install';
const DISCORD_INSTALL_HREF = '/api/agent/messenger/discord/install';

const styles = createStaticStyles(({ css, cssVar }) => ({
  divider: css`
    width: 100%;
    min-width: 320px;
    margin-block: 0 6px;

    &::before,
    &::after {
      border-block-start: 1px dashed ${cssVar.colorBorder} !important;
    }
  `,
  group: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: center;

    @media (width <= 540px) {
      flex-direction: column;
      width: 100%;
    }
  `,
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
    padding: 12px;
    border-radius: 12px;
    background: ${cssVar.colorBgContainer};
  `,
  wrapper: css`
    gap: 14px;
    align-items: center;
    margin-block-start: 48px;
  `,
}));

const MessengerIntegrations = memo(() => {
  const { t } = useTranslation('onboarding');

  const { data, isLoading } = useSWR(messengerKeys.availablePlatforms(), () =>
    messengerService.availablePlatforms(),
  );

  if (isLoading) {
    return (
      <Flexbox className={styles.wrapper}>
        <Divider dashed className={styles.divider}>
          <Skeleton.Button active style={{ height: 14, width: 260 }} />
        </Divider>
        <div className={styles.group}>
          {[0, 1, 2].map((i) => (
            <Skeleton.Button active key={i} style={{ height: 44, width: 180 }} />
          ))}
        </div>
      </Flexbox>
    );
  }

  const platforms = data ?? [];
  if (platforms.length === 0) return null;

  const byId = new Map(platforms.map((p) => [p.id, p]));
  const slack = byId.get('slack');
  const discord = byId.get('discord');
  const telegram = byId.get('telegram');

  return (
    <Flexbox className={styles.wrapper}>
      <Divider dashed className={styles.divider}>
        <Text style={{ fontSize: 13 }} type={'secondary'}>
          {t('agent.messenger.subtitle')}
        </Text>
      </Divider>
      <div className={styles.group}>
        {slack && (
          <Button
            href={SLACK_INSTALL_HREF}
            icon={<Slack.Color size={20} />}
            rel={'noopener noreferrer'}
            size={'large'}
            style={{ fontWeight: 500, minWidth: 180 }}
            target={'_blank'}
          >
            {t('agent.messenger.cta.slack')}
          </Button>
        )}
        {discord && (
          <Button
            href={DISCORD_INSTALL_HREF}
            icon={<Discord.Color size={20} />}
            rel={'noopener noreferrer'}
            size={'large'}
            style={{ fontWeight: 500, minWidth: 180 }}
            target={'_blank'}
          >
            {t('agent.messenger.cta.discord')}
          </Button>
        )}
        {telegram?.botUsername && (
          <Popover
            arrow={false}
            placement={'top'}
            trigger={'hover'}
            content={
              <Flexbox align={'center'} gap={8}>
                <div className={styles.qrWrap}>
                  <QRCode
                    bordered={false}
                    size={160}
                    value={buildTelegramDeepLink(telegram.botUsername)}
                  />
                  <div className={styles.qrIconOverlay}>
                    <PlatformAvatar platform={'telegram'} size={36} />
                  </div>
                </div>
                <Text style={{ fontSize: 12 }} type={'secondary'}>
                  {t('agent.messenger.telegramQrCaption')}
                </Text>
              </Flexbox>
            }
          >
            <Button
              href={buildTelegramDeepLink(telegram.botUsername)}
              icon={<Telegram.Color size={20} />}
              rel={'noopener noreferrer'}
              size={'large'}
              style={{ fontWeight: 500, minWidth: 180 }}
              target={'_blank'}
            >
              {t('agent.messenger.cta.telegram')}
            </Button>
          </Popover>
        )}
      </div>
    </Flexbox>
  );
});

MessengerIntegrations.displayName = 'OnboardingMessengerIntegrations';

export default MessengerIntegrations;

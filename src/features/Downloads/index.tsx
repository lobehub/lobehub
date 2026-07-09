'use client';

import { DOWNLOAD_URL } from '@lobechat/const';
import { Block, Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import {
  ChevronRight,
  Download,
  ExternalLink,
  MessageCircle,
  Monitor,
  Smartphone,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import useSWR from 'swr';

import { type MessengerPlatform, PlatformBrandIcon } from '@/features/Messenger/constants';
import { messengerKeys } from '@/libs/swr/keys';
import type { SerializedMessengerPlatformDefinition } from '@/server/services/messenger/platforms/types';
import { messengerService } from '@/services/messenger';

const platformOrder: MessengerPlatform[] = ['telegram', 'slack', 'discord'];

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionRow: css`
    flex-wrap: wrap;
    margin-block-start: auto;
  `,
  card: css`
    min-height: 260px;
    padding: 24px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  content: css`
    width: min(100%, 1120px);
    margin-block: 0;
    margin-inline: auto;
    padding-block: 32px 96px;
    padding-inline: 24px;

    @media (width <= 760px) {
      padding-block-start: 16px;
      padding-inline: 16px;
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;

    @media (width <= 960px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    @media (width <= 760px) {
      grid-template-columns: 1fr;
    }
  `,
  iconBox: css`
    width: 44px;
    height: 44px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillQuaternary};
  `,
  page: css`
    overflow-y: auto;
    height: 100%;
    min-height: 100%;
    background: ${cssVar.colorBgLayout};
  `,
  platformGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
    margin-block: 22px;
  `,
  platformItem: css`
    min-height: 44px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;

    background: ${cssVar.colorFillQuaternary};
  `,
  platformMessage: css`
    display: flex;
    grid-column: 1 / -1;
    align-items: center;
    min-height: 44px;
  `,
}));

const openExternal = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

const sortMessengerPlatforms = (platforms: SerializedMessengerPlatformDefinition[]) =>
  [...platforms].sort((a, b) => platformOrder.indexOf(a.id) - platformOrder.indexOf(b.id));

const DownloadsPage = memo(() => {
  const { t } = useTranslation('setting');
  const navigate = useNavigate();
  const platformsSWR = useSWR(messengerKeys.availablePlatforms(), () =>
    messengerService.availablePlatforms(),
  );

  const messengerPlatforms = useMemo(
    () => sortMessengerPlatforms(platformsSWR.data ?? []),
    [platformsSWR.data],
  );

  const renderMessengerPlatformGrid = () => {
    if (platformsSWR.isLoading) {
      return [0, 1, 2].map((item) => (
        <Skeleton.Button active key={item} style={{ height: 44, width: '100%' }} />
      ));
    }

    if (platformsSWR.error) {
      return (
        <div className={styles.platformMessage}>
          <Text type="secondary">{t('downloads.messenger.loadFailed')}</Text>
        </div>
      );
    }

    if (messengerPlatforms.length === 0) {
      return (
        <div className={styles.platformMessage}>
          <Text type="secondary">{t('downloads.messenger.empty')}</Text>
        </div>
      );
    }

    return messengerPlatforms.map((platform) => (
      <Flexbox horizontal align="center" className={styles.platformItem} gap={10} key={platform.id}>
        <PlatformBrandIcon platform={platform.id as MessengerPlatform} size={18} />
        <Text>{platform.name}</Text>
      </Flexbox>
    ));
  };

  return (
    <div className={styles.page}>
      <main className={styles.content}>
        <div className={styles.grid}>
          <Block className={styles.card}>
            <Flexbox gap={18} height="100%">
              <Flexbox align="center" className={styles.iconBox} justify="center">
                <Icon icon={Smartphone} size={22} />
              </Flexbox>
              <Flexbox gap={8}>
                <Text as="h2" style={{ fontSize: 20 }} weight={700}>
                  {t('downloads.mobile.title')}
                </Text>
                <Text type="secondary">{t('downloads.mobile.desc')}</Text>
              </Flexbox>
              <Flexbox horizontal className={styles.actionRow} gap={10}>
                <Button
                  icon={ExternalLink}
                  type="primary"
                  onClick={() => openExternal(DOWNLOAD_URL.mobile)}
                >
                  {t('downloads.mobile.cta')}
                </Button>
              </Flexbox>
            </Flexbox>
          </Block>

          <Block className={styles.card}>
            <Flexbox gap={18} height="100%">
              <Flexbox align="center" className={styles.iconBox} justify="center">
                <Icon icon={Monitor} size={22} />
              </Flexbox>
              <Flexbox gap={8}>
                <Text as="h2" style={{ fontSize: 20 }} weight={700}>
                  {t('downloads.desktop.title')}
                </Text>
                <Text type="secondary">{t('downloads.desktop.desc')}</Text>
              </Flexbox>
              <Flexbox horizontal className={styles.actionRow} gap={10}>
                <Button icon={Download} onClick={() => openExternal(DOWNLOAD_URL.default)}>
                  {t('downloads.desktop.cta')}
                </Button>
              </Flexbox>
            </Flexbox>
          </Block>

          <Block className={styles.card}>
            <Flexbox gap={18} height="100%">
              <Flexbox align="center" className={styles.iconBox} justify="center">
                <Icon icon={MessageCircle} size={22} />
              </Flexbox>
              <Flexbox gap={8}>
                <Text as="h2" style={{ fontSize: 20 }} weight={700}>
                  {t('downloads.messenger.title')}
                </Text>
                <Text type="secondary">{t('downloads.messenger.desc')}</Text>
              </Flexbox>
              <div className={styles.platformGrid}>{renderMessengerPlatformGrid()}</div>
              <Flexbox horizontal className={styles.actionRow} gap={10}>
                <Button icon={ChevronRight} onClick={() => navigate('/settings/messenger')}>
                  {t('downloads.messenger.cta')}
                </Button>
              </Flexbox>
            </Flexbox>
          </Block>
        </div>
      </main>
    </div>
  );
});

DownloadsPage.displayName = 'DownloadsPage';

export default DownloadsPage;

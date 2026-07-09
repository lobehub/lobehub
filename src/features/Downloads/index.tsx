'use client';

import { DOWNLOAD_URL } from '@lobechat/const';
import { ActionIcon, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import {
  ArrowLeft,
  ChevronRight,
  Download,
  ExternalLink,
  MessageCircle,
  Monitor,
  Smartphone,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { type MessengerPlatform, PlatformBrandIcon } from '@/features/Messenger/constants';

const messengerPlatforms: { label: string; platform: MessengerPlatform }[] = [
  { label: 'Telegram', platform: 'telegram' },
  { label: 'Slack', platform: 'slack' },
  { label: 'Discord', platform: 'discord' },
];

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
  cardBody: css`
    max-width: 520px;
  `,
  content: css`
    width: min(100%, 980px);
    margin-block: 0;
    margin-inline: auto;
    padding-block: 44px 96px;
    padding-inline: 24px;

    @media (width <= 760px) {
      padding-block-start: 32px;
      padding-inline: 16px;
    }
  `,
  desktopPreview: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    min-height: 140px;
    margin-block-start: auto;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;

    background:
      linear-gradient(${cssVar.colorBorderSecondary} 1px, transparent 1px),
      linear-gradient(90deg, ${cssVar.colorBorderSecondary} 1px, transparent 1px),
      ${cssVar.colorFillQuaternary};
    background-size: 28px 28px;
  `,
  desktopWindow: css`
    position: absolute;
    inset-block-start: 24px;
    inset-inline: 28px;

    height: 92px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 10px;

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
  desktopWindowBar: css`
    height: 28px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    border-start-start-radius: 10px;
    border-start-end-radius: 10px;

    background: ${cssVar.colorFillSecondary};
  `,
  featured: css`
    grid-column: 1 / -1;
    min-height: 320px;
    padding: 28px;

    @media (width <= 760px) {
      min-height: unset;
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;

    @media (width <= 760px) {
      grid-template-columns: 1fr;
    }
  `,
  header: css`
    position: sticky;
    z-index: 2;
    inset-block-start: 0;

    height: 52px;
    padding-inline: 12px 20px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  heroCopy: css`
    margin-block-end: 28px;
    text-align: center;
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
  phoneFrame: css`
    position: relative;

    width: 150px;
    height: 250px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 26px;

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowTertiary};

    &::before {
      content: '';

      position: absolute;
      inset-block-start: 12px;
      inset-inline-start: 50%;
      transform: translateX(-50%);

      width: 48px;
      height: 5px;
      border-radius: 999px;

      background: ${cssVar.colorFillSecondary};
    }
  `,
  phoneLine: css`
    height: 12px;
    border-radius: 999px;
    background: ${cssVar.colorFillTertiary};
  `,
  phoneScreen: css`
    position: absolute;
    inset-block: 30px 14px;
    inset-inline: 14px;

    padding: 14px;
    border-radius: 18px;

    background:
      linear-gradient(180deg, ${cssVar.colorFillQuaternary}, transparent 62%),
      ${cssVar.colorBgContainer};
  `,
  platformList: css`
    display: grid;
    gap: 10px;
    margin-block: 22px;
  `,
  platformRow: css`
    height: 40px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;

    background: ${cssVar.colorFillQuaternary};
  `,
  title: css`
    font-size: 32px;
    line-height: 1.18;

    @media (width <= 760px) {
      font-size: 26px;
    }
  `,
  visual: css`
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 252px;
  `,
}));

const openExternal = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

const DownloadsPage = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const navigate = useNavigate();

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate('/');
  };

  return (
    <div className={styles.page}>
      <Flexbox horizontal align="center" className={styles.header} gap={8}>
        <ActionIcon icon={ArrowLeft} title={t('back', { ns: 'common' })} onClick={handleBack} />
        <Text strong>{t('downloads.title')}</Text>
      </Flexbox>

      <main className={styles.content}>
        <Flexbox align="center" className={styles.heroCopy} gap={12}>
          <Text as="h1" className={styles.title} weight={700}>
            {t('downloads.heroTitle')}
          </Text>
          <Text style={{ maxWidth: 640, textAlign: 'center' }} type="secondary">
            {t('downloads.heroDesc')}
          </Text>
        </Flexbox>

        <div className={styles.grid}>
          <Block className={`${styles.card} ${styles.featured}`}>
            <Flexbox horizontal gap={28} justify="space-between" wrap="wrap">
              <Flexbox className={styles.cardBody} gap={18}>
                <Flexbox align="center" className={styles.iconBox} justify="center">
                  <Icon icon={Smartphone} size={22} />
                </Flexbox>
                <Flexbox gap={8}>
                  <Text as="h2" style={{ fontSize: 22 }} weight={700}>
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

              <div aria-hidden className={styles.visual}>
                <div className={styles.phoneFrame}>
                  <Flexbox className={styles.phoneScreen} gap={10}>
                    <div className={styles.phoneLine} style={{ width: '64%' }} />
                    <div className={styles.phoneLine} style={{ width: '100%' }} />
                    <div className={styles.phoneLine} style={{ width: '78%' }} />
                    <Flexbox flex={1} justify="flex-end">
                      <Icon icon={MessageCircle} size={44} />
                    </Flexbox>
                  </Flexbox>
                </div>
              </div>
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
              <div aria-hidden className={styles.desktopPreview}>
                <div className={styles.desktopWindow}>
                  <div className={styles.desktopWindowBar} />
                </div>
              </div>
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
              <Flexbox className={styles.platformList}>
                {messengerPlatforms.map(({ label, platform }) => (
                  <Flexbox
                    horizontal
                    align="center"
                    className={styles.platformRow}
                    gap={10}
                    key={platform}
                  >
                    <PlatformBrandIcon platform={platform} size={18} />
                    <Text>{label}</Text>
                  </Flexbox>
                ))}
              </Flexbox>
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

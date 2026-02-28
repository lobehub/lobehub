'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx, responsive } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';

const styles = createStaticStyles(({ css }) => ({
  banner: css`
    position: relative;

    width: 100%;
    padding-block: 24px;
    padding-inline: 32px;
    border-radius: 12px;

    ${responsive.sm} {
      padding-block: 16px;
      padding-inline: 20px;
    }
  `,
  banner_dark: css`
    background: linear-gradient(135deg, #5c3d0e 0%, #7a4f10 50%, #6b3a08 100%);
  `,
  banner_light: css`
    background: linear-gradient(135deg, #fceabb 0%, #f8b500 50%, #e88a20 100%);
  `,
  subtitle: css`
    margin: 0;
    font-size: 14px;
    font-weight: 400;
    line-height: 1.5;

    ${responsive.sm} {
      font-size: 12px;
    }
  `,
  subtitle_dark: css`
    color: rgb(255 255 255 / 65%);
  `,
  subtitle_light: css`
    color: rgb(0 0 0 / 65%);
  `,
  symbols: css`
    pointer-events: none;

    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;

    overflow: hidden;

    width: 50%;
    border-radius: 0 12px 12px 0;

    background: url('/images/banner_creator.png') right center / auto 100% no-repeat;

    ${responsive.sm} {
      display: none;
    }
  `,
  title: css`
    margin: 0;
    font-size: 22px;
    font-weight: 700;
    line-height: 1.3;

    ${responsive.sm} {
      font-size: 18px;
    }
  `,
  title_dark: css`
    color: rgb(255 255 255 / 88%);
  `,
  title_light: css`
    color: rgb(0 0 0 / 88%);
  `,
}));

const CreatorRewardBanner = memo(() => {
  const { t } = useTranslation('discover');
  const isDark = useIsDark();

  return (
    <Flexbox
      className={cx(styles.banner, isDark ? styles.banner_dark : styles.banner_light)}
      width={'100%'}
    >
      <Flexbox gap={8} style={{ position: 'relative', zIndex: 1 }}>
        <h2 className={cx(styles.title, isDark ? styles.title_dark : styles.title_light)}>
          {t('home.creatorReward.title')}
        </h2>
        <p className={cx(styles.subtitle, isDark ? styles.subtitle_dark : styles.subtitle_light)}>
          {t('home.creatorReward.subtitle')}
        </p>
        <div style={{ marginBlockStart: 4 }}>
          <a href={'#'} rel={'noopener noreferrer'} target={'_blank'}>
            <Button type={'primary'}>{t('home.creatorReward.action')}</Button>
          </a>
        </div>
      </Flexbox>
      <div className={styles.symbols} />
    </Flexbox>
  );
});

export default CreatorRewardBanner;

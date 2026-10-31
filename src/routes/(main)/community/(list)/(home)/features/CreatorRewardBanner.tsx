'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { imageUrl, OFFICIAL_SITE } from '@/const/url';
import { useIsDark } from '@/hooks/useIsDark';
import { sx } from '@/styles/sx';

const styles = stylex.create({
  banner: {
    position: 'relative',
    width: '100%',
    paddingBlock: { default: '24px', [media.sm]: '16px' },
    paddingInline: { default: '32px', [media.sm]: '20px' },
    borderRadius: '12px',
  },
  bannerDark: {
    backgroundImage: 'linear-gradient(135deg, #5c3d0e 0%, #7a4f10 50%, #6b3a08 100%)',
  },
  bannerLight: {
    backgroundImage: 'linear-gradient(135deg, #fceabb 0%, #f8b500 50%, #e88a20 100%)',
  },
  subtitle: {
    margin: '0',
    fontSize: { default: '14px', [media.sm]: '12px' },
    fontWeight: 400,
    lineHeight: 1.5,
  },
  subtitleDark: { color: 'rgb(255 255 255 / 65%)' },
  subtitleLight: { color: 'rgb(0 0 0 / 65%)' },
  symbols: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlock: '0',
    insetInlineEnd: '0',
    overflow: 'hidden',
    width: '50%',
    borderTopLeftRadius: '0',
    borderTopRightRadius: '12px',
    borderBottomRightRadius: '12px',
    borderBottomLeftRadius: '0',
    backgroundPosition: 'right center',
    backgroundSize: 'auto 100%',
    backgroundRepeat: 'no-repeat',
    display: { default: null, [media.sm]: 'none' },
  },
  title: {
    margin: '0',
    fontSize: { default: '22px', [media.sm]: '18px' },
    fontWeight: 700,
    lineHeight: 1.3,
  },
  titleDark: { color: 'rgb(255 255 255 / 88%)' },
  titleLight: { color: 'rgb(0 0 0 / 88%)' },
});

const CreatorRewardBanner = memo(() => {
  const { t } = useTranslation('discover');
  const isDark = useIsDark();

  return (
    <Flexbox
      width={'100%'}
      className={
        stylex.props(styles.banner, isDark ? styles.bannerDark : styles.bannerLight).className
      }
    >
      <Flexbox gap={8} style={{ position: 'relative', zIndex: 1 }}>
        <h2 {...stylex.props(styles.title, isDark ? styles.titleDark : styles.titleLight)}>
          {t('home.creatorReward.title')}
        </h2>
        <p {...stylex.props(styles.subtitle, isDark ? styles.subtitleDark : styles.subtitleLight)}>
          {t('home.creatorReward.subtitle')}
        </p>
        <div style={{ marginBlockStart: 4 }}>
          <a
            href={`${OFFICIAL_SITE}/creator?utm_source=lobehub`}
            rel={'noopener noreferrer'}
            target={'_blank'}
          >
            <Button type={'primary'}>{t('home.creatorReward.action')}</Button>
          </a>
        </div>
      </Flexbox>
      <div
        {...sx(styles.symbols, undefined, {
          // Runtime CDN URL, so it cannot live in stylex.create.
          backgroundImage: `url(${imageUrl('banner_creator.png')})`,
        })}
      />
    </Flexbox>
  );
});

export default CreatorRewardBanner;

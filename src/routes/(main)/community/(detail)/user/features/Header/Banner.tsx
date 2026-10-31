'use client';

import { Center } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { sx } from '@/styles/sx';

const WIDE = '@media (width <= 1720px)';

// Note: at the `sm` breakpoint the wide-screen rules also match, and they used to win
// for height / padding / border-radius, so only the effective values are kept.
const styles = stylex.create({
  banner: {
    position: { default: 'absolute', [media.sm]: 'relative' },
    insetBlockStart: '0',
    insetInlineStart: '0',
    width: { default: '100%', [media.sm]: 'calc(100% + 32px)' },
    height: { default: '160px', [WIDE]: '144px' },
    padding: { default: '16px', [WIDE]: '0' },
    marginBlockStart: { default: null, [media.sm]: '-16px' },
    marginBlockEnd: { default: null, [media.sm]: '0' },
    marginInline: { default: null, [media.sm]: '-16px' },
  },
  bannerAvatar: { filter: 'blur(100px)' },
  bannerInner: {
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    height: '100%',
    borderRadius: { default: cssVar.borderRadiusLG, [WIDE]: '0' },
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  placeholder: {
    position: 'relative',
    width: '100%',
    height: '64px',
    minHeight: '64px',
    display: { default: null, [media.sm]: 'none' },
  },
});

interface BannerProps {
  avatar?: string | null;
  bannerUrl?: string | null;
}

const Banner = memo<BannerProps>(({ avatar, bannerUrl }) => {
  // Use bannerUrl if available, otherwise fall back to blurred avatar
  const backgroundImage = bannerUrl || avatar;
  const shouldBlur = !bannerUrl && !!avatar;

  return (
    <>
      <div {...stylex.props(styles.banner)}>
        <Center className={stylex.props(styles.bannerInner).className}>
          {backgroundImage && (
            <div
              {...sx(shouldBlur && styles.bannerAvatar, undefined, {
                backgroundImage: `url(${backgroundImage})`,
                backgroundPosition: 'center',
                backgroundSize: 'cover',
                height: '100%',
                width: '100%',
              })}
            />
          )}
        </Center>
      </div>
      <div {...stylex.props(styles.placeholder)} />
    </>
  );
});

export default Banner;

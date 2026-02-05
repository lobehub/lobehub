'use client';

import { Center } from '@lobehub/ui';
import { createStaticStyles, responsive } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  banner: css`
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;

    width: 100%;
    height: 160px;
    padding: 16px;

    ${responsive.sm} {
      position: relative;

      width: calc(100% + 32px);
      height: 120px;
      margin-block: -16px 0;
      margin-inline: -16px;
    }

    @media (width <= 1720px) {
      height: 144px;
      padding: 0;
    }
  `,
  bannerAvatar: css`
    filter: blur(100px);
  `,
  bannerInner: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    height: 100%;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillTertiary};

    @media (width <= 1720px) {
      border-radius: 0;
    }
  `,
  button: css`
    position: absolute;
    inset-block-end: -16px;
    inset-inline-end: 16px;
  `,
  placeholder: css`
    position: relative;
    width: 100%;
    height: 64px;
    min-height: 64px;

    ${responsive.sm} {
      display: none;
    }
  `,
}));

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
      <div className={styles.banner}>
        <Center className={styles.bannerInner}>
          {backgroundImage && (
            <div
              className={shouldBlur ? styles.bannerAvatar : undefined}
              style={{
                backgroundImage: `url(${backgroundImage})`,
                backgroundPosition: 'center',
                backgroundSize: 'cover',
                height: '100%',
                width: '100%',
              }}
            />
          )}
        </Center>
      </div>
      <div className={styles.placeholder} />
    </>
  );
});

export default Banner;

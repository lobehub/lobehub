import { type DivProps } from '@lobehub/ui';
import { Avatar, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { memo } from 'react';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  banner: css`
    position: relative;

    overflow: hidden;

    height: 64px;
    margin-block-end: -56px;

    background: ${cssVar.colorFillSecondary};
  `,
  bannerImg: css`
    position: absolute;
    filter: blur(40px) saturate(1.5);
  `,
}));

interface CardBannerProps extends DivProps {
  avatar?: string | ReactNode;
  loading?: boolean;
  mask?: boolean;
  maskColor?: string;
  size?: number;
}

const CardBanner = memo<CardBannerProps>(
  ({ avatar, className, size = 600, children, ...props }) => {
    return (
      <Flexbox
        align={'center'}
        className={cx(styles.banner, className)}
        justify={'center'}
        style={avatar ? {} : { backgroundColor: cssVar.colorFillTertiary }}
        width={'100%'}
        {...props}
      >
        {avatar && (
          <Avatar
            alt={'banner'}
            avatar={avatar}
            className={styles.bannerImg}
            shape={'square'}
            size={size}
          />
        )}
        {children}
      </Flexbox>
    );
  },
);

export default CardBanner;

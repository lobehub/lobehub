import { type DivProps } from '@lobehub/ui';
import { Avatar, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';
import { memo } from 'react';

import { sx } from '@/styles/sx';

const styles = stylex.create({
  banner: {
    position: 'relative',
    overflow: 'hidden',
    height: '64px',
    marginBlockEnd: '-56px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  bannerEmpty: { backgroundColor: cssVar.colorFillTertiary },
  bannerImg: { position: 'absolute', filter: 'blur(40px) saturate(1.5)' },
});

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
        justify={'center'}
        width={'100%'}
        {...sx([styles.banner, !avatar && styles.bannerEmpty], className)}
        {...props}
      >
        {avatar && (
          <Avatar
            alt={'banner'}
            avatar={avatar}
            className={stylex.props(styles.bannerImg).className}
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

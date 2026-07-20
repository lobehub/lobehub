'use client';

import { type FC, type PropsWithChildren } from 'react';

import BackButton from './BackButton';
import { styles } from './style';

interface BannerProps extends PropsWithChildren {
  onBack?: () => void;
  src?: string;
}

const Banner: FC<BannerProps> = ({ children, onBack, src }) => (
  <div className={styles.banner} style={src ? { backgroundImage: `url(${src})` } : undefined}>
    {onBack && <BackButton onClick={onBack} />}
    {children}
  </div>
);

export default Banner;

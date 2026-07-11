'use client';

import { ActionIcon } from '@lobehub/ui';
import { ArrowLeftIcon } from 'lucide-react';
import { type FC, type PropsWithChildren } from 'react';

import { styles } from './style';

interface BannerProps extends PropsWithChildren {
  onBack?: () => void;
  src?: string;
}

const Banner: FC<BannerProps> = ({ children, onBack, src }) => (
  <div className={styles.banner} style={src ? { backgroundImage: `url(${src})` } : undefined}>
    {onBack && <ActionIcon className={styles.backButton} icon={ArrowLeftIcon} onClick={onBack} />}
    {children}
  </div>
);

export default Banner;

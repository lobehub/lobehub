'use client';

import { ActionIcon } from '@lobehub/ui';
import { ArrowLeftIcon } from 'lucide-react';
import { type FC } from 'react';

import { styles } from './style';

interface BannerProps {
  onBack?: () => void;
  src?: string;
}

const Banner: FC<BannerProps> = ({ onBack, src }) => (
  <div className={styles.banner} style={src ? { backgroundImage: `url(${src})` } : undefined}>
    {onBack && <ActionIcon className={styles.backButton} icon={ArrowLeftIcon} onClick={onBack} />}
  </div>
);

export default Banner;

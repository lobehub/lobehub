'use client';

import { ActionIcon } from '@lobehub/ui';
import { ChevronLeftIcon } from 'lucide-react';
import { type FC } from 'react';

import { styles } from './style';

interface BackButtonProps {
  onClick?: () => void;
}

const BackButton: FC<BackButtonProps> = ({ onClick }) => (
  <ActionIcon
    className={styles.backButton}
    icon={ChevronLeftIcon}
    size={{ blockSize: 28, size: 16 }}
    style={{ borderRadius: '50%' }}
    onClick={onClick}
  />
);

export default BackButton;

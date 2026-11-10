'use client';

import { ActionIcon } from '@lobehub/ui';
import { PinIcon, PinOffIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { electronSystemService } from '@/services/electron/system';
import { electronStylish } from '@/styles/electron';

const PinOnTopButton = memo(() => {
  const { t } = useTranslation('electron');
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    let mounted = true;
    void electronSystemService.isWindowAlwaysOnTop().then((value) => {
      if (mounted) setPinned(value);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const toggle = async () => {
    const next = !pinned;
    await electronSystemService.setWindowAlwaysOnTop(next);
    setPinned(next);
  };

  return (
    <ActionIcon
      active={pinned}
      className={electronStylish.nodrag}
      icon={pinned ? PinIcon : PinOffIcon}
      size={{ blockSize: 28, size: 14 }}
      tooltipProps={{ placement: 'bottom' }}
      title={t(pinned ? 'window.unpinFromTop' : 'window.pinToTop', {
        defaultValue: pinned ? 'Unpin from top' : 'Pin on top',
      })}
      onClick={toggle}
    />
  );
});

PinOnTopButton.displayName = 'PinOnTopButton';

export default PinOnTopButton;

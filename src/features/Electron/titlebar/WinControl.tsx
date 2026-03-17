'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Maximize2, MinusIcon, XIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { electronSystemService } from '@/services/electron/system';
import { electronStylish } from '@/styles/electron';

export const WINDOW_CONTROL_WIDTH = 112;

const styles = createStaticStyles(({ css, cssVar }) => ({
  closeButton: css`
    border-radius: 8px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorBgBase};
      background: ${cssVar.colorError};
    }
  `,
  container: css`
    width: ${WINDOW_CONTROL_WIDTH}px;
    min-width: ${WINDOW_CONTROL_WIDTH}px;
  `,
  controlButton: css`
    border-radius: 8px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

const WinControl = memo(() => {
  const { t } = useTranslation('electron');

  const controls = useMemo(
    () => [
      {
        icon: MinusIcon,
        key: 'minimize',
        label: t('window.minimize'),
        onClick: () => void electronSystemService.minimizeWindow(),
      },
      {
        icon: Maximize2,
        key: 'maximize',
        label: t('window.maximize'),
        onClick: () => void electronSystemService.maximizeWindow(),
      },
      {
        icon: XIcon,
        key: 'close',
        label: t('window.close'),
        onClick: () => void electronSystemService.closeWindow(),
      },
    ],
    [t],
  );

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={cx(styles.container, electronStylish.nodrag)}
      gap={4}
      justify={'flex-end'}
    >
      {controls.map((control) => (
        <ActionIcon
          className={control.key === 'close' ? styles.closeButton : styles.controlButton}
          icon={control.icon}
          key={control.key}
          size={{ blockSize: 28, size: 14 }}
          title={control.label}
          tooltipProps={{ placement: 'bottom' }}
          onClick={control.onClick}
        />
      ))}
    </Flexbox>
  );
});

export default WinControl;

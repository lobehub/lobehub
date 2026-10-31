'use client';

import { ActionIcon, cx, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Maximize2Icon, Minimize2Icon, MinusIcon, XIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { electronSystemService } from '@/services/electron/system';
import { electronStylish } from '@/styles/electron';

export const WINDOW_CONTROL_WIDTH = 112;

const styles = stylex.create({
  closeButton: {
    borderRadius: '8px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorBgBase },
    backgroundColor: { 'default': null, ':hover': cssVar.colorError },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  container: (width: string) => ({ width, minWidth: width }),
  controlButton: {
    borderRadius: '8px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

const WinControl = memo(() => {
  const { t } = useTranslation('electron');
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;

    const syncWindowState = async () => {
      const nextState = await electronSystemService.isWindowMaximized();
      if (mounted) setIsMaximized(nextState);
    };

    void syncWindowState();

    return () => {
      mounted = false;
    };
  }, []);

  const controls = useMemo(
    () => [
      {
        icon: MinusIcon,
        key: 'minimize',
        label: t('window.minimize'),
        onClick: () => void electronSystemService.minimizeWindow(),
      },
      {
        icon: isMaximized ? Minimize2Icon : Maximize2Icon,
        key: 'maximize',
        label: t(isMaximized ? 'window.restore' : 'window.maximize'),
        onClick: async () => {
          await electronSystemService.maximizeWindow();
          setIsMaximized(await electronSystemService.isWindowMaximized());
        },
      },
      {
        icon: XIcon,
        key: 'close',
        label: t('window.close'),
        onClick: () => void electronSystemService.closeWindow(),
      },
    ],
    [isMaximized, t],
  );

  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={4}
      justify={'flex-end'}
      className={cx(
        stylex.props(styles.container(`${WINDOW_CONTROL_WIDTH}px`)).className,
        electronStylish.nodrag,
      )}
    >
      {controls.map((control) => (
        <ActionIcon
          icon={control.icon}
          key={control.key}
          size={{ blockSize: 28, size: 14 }}
          title={control.label}
          tooltipProps={{ placement: 'bottom' }}
          className={
            stylex.props(control.key === 'close' ? styles.closeButton : styles.controlButton)
              .className
          }
          onClick={control.onClick}
        />
      ))}
    </Flexbox>
  );
});

export default WinControl;

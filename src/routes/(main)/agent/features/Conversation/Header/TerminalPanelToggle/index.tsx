'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { ActionIcon } from '@lobehub/ui';
import { SquareTerminalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { isDesktop } from '@/const/version';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

const TerminalPanelToggle = memo(() => {
  const { t } = useTranslation('chat');
  const [showTerminalPanel, toggleTerminalPanel] = useGlobalStore((s) => [
    systemStatusSelectors.showTerminalPanel(s),
    s.toggleTerminalPanel,
  ]);
  const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.ToggleTerminalPanel));

  // On the web the panel has no local shell to fall back on: it renders only
  // while a device that can host one is connected, so the toggle would be a
  // dead button without one. The device list is fetched by the panel itself,
  // which is mounted alongside this header.
  const hasDevice = useDeviceStore(deviceSelectors.hasTerminalTarget);

  if (!isDesktop && !hasDevice) return null;

  return (
    <ActionIcon
      active={showTerminalPanel}
      icon={SquareTerminalIcon}
      size={DESKTOP_HEADER_ICON_SMALL_SIZE}
      title={t('terminalPanel.title')}
      tooltipProps={{ hotkey, placement: 'bottom' }}
      onClick={() => toggleTerminalPanel()}
    />
  );
});

export default TerminalPanelToggle;

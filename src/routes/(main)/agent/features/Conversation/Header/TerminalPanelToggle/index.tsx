'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { ActionIcon } from '@lobehub/ui';
import { SquareTerminalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { isDesktop } from '@/const/version';
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

  if (!isDesktop) return null;

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

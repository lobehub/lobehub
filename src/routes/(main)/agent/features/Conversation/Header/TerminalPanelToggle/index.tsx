'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { ActionIcon } from '@lobehub/ui';
import { SquareTerminalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useTerminalEntry } from '@/features/ChatTerminal/useTerminalEntry';
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

  // Shown for coding agents only, and only where a shell can run; other agents
  // reach the terminal from the Overview resources (see `useTerminalEntry`).
  const visible = useTerminalEntry('header');

  if (!visible) return null;

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

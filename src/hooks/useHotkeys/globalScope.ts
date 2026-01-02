import { INBOX_SESSION_ID } from '@lobechat/const';
import { HotkeyEnum } from '@lobechat/types';

import { useNavigateToAgent } from '@/hooks/useNavigateToAgent';
import { usePinnedAgentState } from '@/hooks/usePinnedAgentState';
import { useGlobalStore } from '@/store/global';

import { useHotkeyById } from './useHotkeyById';

// 切换到会话标签(并聚焦到Lobe AI)
export const useNavigateToChatHotkey = () => {
  const navigateToAgent = useNavigateToAgent();
  const [, { unpinAgent }] = usePinnedAgentState();

  return useHotkeyById(HotkeyEnum.NavigateToChat, () => {
    navigateToAgent(INBOX_SESSION_ID);
    unpinAgent();
  });
};

export const useOpenHotkeyHelperHotkey = () => {
  const [open, updateSystemStatus] = useGlobalStore((s) => [
    s.status.showHotkeyHelper,
    s.updateSystemStatus,
  ]);

  return useHotkeyById(HotkeyEnum.OpenHotkeyHelper, () =>
    updateSystemStatus({ showHotkeyHelper: !open }),
  );
};

export const useToggleLeftPanelHotkey = () => {
  const isZenMode = useGlobalStore((s) => s.status.zenMode);
  const toggleLeftPanel = useGlobalStore((s) => s.toggleLeftPanel);
  return useHotkeyById(HotkeyEnum.ToggleLeftPanel, () => toggleLeftPanel(), {
    enableOnContentEditable: true,
    enabled: !isZenMode,
  });
};

export const useToggleRightPanelHotkey = () => {
  const isZenMode = useGlobalStore((s) => s.status.zenMode);
  const toggleConfig = useGlobalStore((s) => s.toggleRightPanel);

  return useHotkeyById(HotkeyEnum.ToggleRightPanel, () => toggleConfig(), {
    enableOnContentEditable: true,
    enabled: !isZenMode,
  });
};

// CMDK
export const useCommandPaletteHotkey = () => {
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);

  return useHotkeyById(HotkeyEnum.CommandPalette, () => toggleCommandMenu(), {
    enableOnContentEditable: true,
  });
};

export const useRegisterGlobalHotkeys = () => {
  // 全局自动注册不需要 enableScope
  useToggleLeftPanelHotkey();
  useToggleRightPanelHotkey();
  useNavigateToChatHotkey();
  useOpenHotkeyHelperHotkey();
  useCommandPaletteHotkey();
};

import { useEffect } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { HotkeyEnum, HotkeyScopeEnum } from '@/types/hotkey';

import { useHotkeyById } from './useHotkeyById';

export const useToggleImageRightPanelHotkey = () => {
  const showImageTopicPanel = useGlobalStore(systemStatusSelectors.showImageTopicPanel);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  return useHotkeyById(HotkeyEnum.ToggleRightPanel, () =>
    updateSystemStatus({
      imageTopicPanelWidth: showImageTopicPanel ? 0 : 80,
      showImageTopicPanel: !showImageTopicPanel,
    }),
  );
};

// 注册聚合

export const useRegisterImageHotkeys = () => {
  const { enableScope, disableScope } = useHotkeysContext();

  // Layout
  useToggleImageRightPanelHotkey();

  useEffect(() => {
    enableScope(HotkeyScopeEnum.Image);
    return () => disableScope(HotkeyScopeEnum.Image);
  }, []);
};

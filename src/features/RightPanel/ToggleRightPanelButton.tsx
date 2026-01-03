'use client';

import { ActionIcon, type ActionIconProps } from '@lobehub/ui';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { HotkeyEnum } from '@/types/hotkey';

export const TOGGLE_BUTTON_ID = 'toggle_right_panel_button';

interface ToggleRightPanelButtonProps {
  icon?: ActionIconProps['icon'];
  showActive?: boolean;
  size?: ActionIconProps['size'];
  title?: ReactNode;
}

const ToggleRightPanelButton = memo<ToggleRightPanelButtonProps>(
  ({ title, showActive, icon, size }) => {
    const [expand, togglePanel] = useGlobalStore((s) => [
      systemStatusSelectors.showRightPanel(s),
      s.toggleRightPanel,
    ]);
    const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.ToggleRightPanel));

    const { t } = useTranslation(['chat', 'hotkey']);

    return (
      <ActionIcon
        active={showActive ? expand : undefined}
        icon={icon || (expand ? PanelRightClose : PanelRightOpen)}
        id={TOGGLE_BUTTON_ID}
        onClick={() => togglePanel()}
        size={size || DESKTOP_HEADER_ICON_SIZE}
        title={title || t('toggleRightPanel.title', { ns: 'hotkey' })}
        tooltipProps={{
          hotkey,
          placement: 'bottom',
        }}
      />
    );
  },
);

export default ToggleRightPanelButton;

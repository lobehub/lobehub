'use client';

import { type ActionIconProps } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { HotkeyEnum } from '@/types/hotkey';

export const TOGGLE_BUTTON_ID = 'toggle_left_panel_button';

interface ToggleLeftPanelButtonProps {
  icon?: ActionIconProps['icon'];
  showActive?: boolean;
  size?: ActionIconProps['size'];
  title?: ReactNode;
}

const ToggleLeftPanelButton = memo<ToggleLeftPanelButtonProps>(
  ({ title, showActive, icon, size }) => {
    const [expand, togglePanel] = useGlobalStore((s) => [
      systemStatusSelectors.showLeftPanel(s),
      s.toggleLeftPanel,
    ]);
    const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.ToggleLeftPanel));

    const { t } = useTranslation(['chat', 'hotkey']);

    return (
      <ActionIcon
        active={showActive ? expand : undefined}
        icon={icon || (expand ? PanelLeftClose : PanelLeftOpen)}
        id={TOGGLE_BUTTON_ID}
        size={size || DESKTOP_HEADER_ICON_SIZE}
        title={title || t('toggleLeftPanel.title', { ns: 'hotkey' })}
        tooltipProps={{
          hotkey,
          placement: 'bottom',
        }}
        onClick={() => togglePanel()}
      />
    );
  },
);

export default ToggleLeftPanelButton;

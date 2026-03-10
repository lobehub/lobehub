'use client';

import { type ActionIconProps } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { HotkeyEnum } from '@/types/hotkey';

export const TOGGLE_BUTTON_ID = 'toggle_right_panel_button';

interface ToggleRightPanelButtonProps {
  hideWhenExpanded?: boolean;
  icon?: ActionIconProps['icon'];
  showActive?: boolean;
  size?: ActionIconProps['size'];
  title?: ReactNode;
}

const ToggleRightPanelButton = memo<ToggleRightPanelButtonProps>(
  ({ title, showActive, icon, hideWhenExpanded, size }) => {
    const [expand, togglePanel] = useGlobalStore((s) => [
      systemStatusSelectors.showRightPanel(s),
      s.toggleRightPanel,
    ]);
    const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.ToggleRightPanel));

    const { t } = useTranslation(['chat', 'hotkey']);

    if (hideWhenExpanded && expand) return null;
    return (
      <ActionIcon
        active={showActive ? expand : undefined}
        icon={icon || (expand ? PanelRightClose : PanelRightOpen)}
        id={TOGGLE_BUTTON_ID}
        size={size || DESKTOP_HEADER_ICON_SIZE}
        title={title || t('toggleRightPanel.title', { ns: 'hotkey' })}
        tooltipProps={{
          hotkey,
          placement: 'bottom',
        }}
        onClick={() => togglePanel()}
      />
    );
  },
);

export default ToggleRightPanelButton;

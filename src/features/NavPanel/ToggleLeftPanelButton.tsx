'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { type ActionIconProps } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

export const TOGGLE_BUTTON_ID = 'toggle_left_panel_button';

interface ToggleLeftPanelButtonProps {
  icon?: ActionIconProps['icon'];
  /**
   * DOM id for the button. Defaults to the shared {@link TOGGLE_BUTTON_ID} which
   * NavPanelDraggable targets for its hover-reveal CSS. Pass a custom id (or `null`)
   * to opt out — e.g. for a persistent instance rendered outside the sidebar panel,
   * to avoid duplicate ids and the hover-hide behavior.
   */
  id?: string | null;
  showActive?: boolean;
  size?: ActionIconProps['size'];
  title?: ReactNode;
}

const ToggleLeftPanelButton = memo<ToggleLeftPanelButtonProps>(
  ({ title, showActive, icon, size, id = TOGGLE_BUTTON_ID }) => {
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
        id={id ?? undefined}
        size={size || DESKTOP_HEADER_ICON_SMALL_SIZE}
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

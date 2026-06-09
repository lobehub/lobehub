'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { type ActionIconProps } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { isDesktop } from '@/const/version';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { isMacOS } from '@/utils/platform';

export const TOGGLE_BUTTON_ID = 'toggle_left_panel_button';

// On macOS desktop a persistent toggle lives in the titlebar (NavigationBar),
// so in-page instances hide themselves to avoid duplicate collapse buttons.
export const isMacDesktop = isDesktop && isMacOS();

interface ToggleLeftPanelButtonProps {
  /**
   * Render even on macOS desktop, where in-page instances hide by default.
   * The persistent titlebar toggle sets this.
   */
  forceVisible?: boolean;
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
  ({ title, showActive, icon, size, id = TOGGLE_BUTTON_ID, forceVisible }) => {
    const [expand, togglePanel] = useGlobalStore((s) => [
      systemStatusSelectors.showLeftPanel(s),
      s.toggleLeftPanel,
    ]);
    const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.ToggleLeftPanel));

    const { t } = useTranslation(['chat', 'hotkey']);

    if (isMacDesktop && !forceVisible) return null;

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

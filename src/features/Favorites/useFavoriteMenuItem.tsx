import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { type DropdownItem, Hotkey, Icon } from '@lobehub/ui';
import { StarIcon, StarOffIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { type FavoriteTarget, useFavoriteToggle } from './useFavoriteToggle';

interface FavoriteMenuItemOptions {
  /**
   * Show the favorite hotkey beside the item. Only a menu of the open page
   * should: the hotkey toggles the page, not a row in a list.
   */
  showHotkey?: boolean;
}

/** "Add to Favorites" / "Remove from Favorites" for a ⋯ menu. */
export const useFavoriteMenuItem = (
  target: FavoriteTarget | undefined,
  { showHotkey = true }: FavoriteMenuItemOptions = {},
): DropdownItem | null => {
  const { t } = useTranslation('common');
  const { isFavorite, isReady, toggle } = useFavoriteToggle(target);
  const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.ToggleFavorite));

  if (!target) return null;

  return {
    disabled: !isReady,
    extra: showHotkey && hotkey ? <Hotkey keys={hotkey} variant={'borderless'} /> : undefined,
    icon: <Icon icon={isFavorite ? StarOffIcon : StarIcon} />,
    key: 'toggleFavorite',
    label: t(isFavorite ? 'favorite.remove' : 'favorite.add'),
    onClick: () => void toggle(),
  };
};

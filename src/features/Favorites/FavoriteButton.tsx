'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { ActionIcon, type ActionIconSize, cssVar } from '@lobehub/ui';
import { StarIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useHotkeyById } from '@/hooks/useHotkeys/useHotkeyById';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { useOwnsFavoriteHotkey } from './hotkeyOwner';
import { type FavoriteTarget, useFavoriteToggle } from './useFavoriteToggle';

interface FavoriteButtonProps extends FavoriteTarget {
  size?: ActionIconSize;
}

/**
 * Header star that adds the open page to the sidebar Favorites. The most
 * recently mounted star also answers the favorite hotkey.
 */
const FavoriteButton = memo<FavoriteButtonProps>(
  ({ size = DESKTOP_HEADER_ICON_SMALL_SIZE, ...target }) => {
    const { t } = useTranslation('common');
    const { isFavorite, isReady, toggle } = useFavoriteToggle(target);
    const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.ToggleFavorite));
    const ownsHotkey = useOwnsFavoriteHotkey();

    // Typing in a field must not toggle the favorite, so the hotkey stays out of form tags.
    useHotkeyById(HotkeyEnum.ToggleFavorite, () => void toggle(), {
      enableOnFormTags: false,
      enabled: ownsHotkey,
    });

    const label = t(isFavorite ? 'favorite.remove' : 'favorite.add');

    return (
      <ActionIcon
        aria-label={label}
        aria-pressed={isFavorite}
        color={isFavorite ? cssVar.colorWarning : undefined}
        disabled={!isReady}
        fill={isFavorite ? cssVar.colorWarning : 'none'}
        icon={StarIcon}
        size={size}
        title={label}
        tooltipProps={{ hotkey, placement: 'bottom' }}
        onClick={() => void toggle()}
      />
    );
  },
);

FavoriteButton.displayName = 'FavoriteButton';

export default FavoriteButton;

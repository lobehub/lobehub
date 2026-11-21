'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { ActionIcon, type ActionIconSize, cssVar } from '@lobehub/ui';
import { StarIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHotkeyById } from '@/hooks/useHotkeys/useHotkeyById';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { useHeaderActionSize } from '@/styles/density';

import { useOwnsFavoriteHotkey } from './hotkeyOwner';
import { type FavoriteTarget, useFavoriteToggle } from './useFavoriteToggle';

interface FavoriteButtonProps extends FavoriteTarget {
  size?: ActionIconSize;
}

/**
 * Header star that adds the open page to the sidebar Favorites. The most
 * recently mounted star also answers the favorite hotkey.
 */
const FavoriteButton = memo<FavoriteButtonProps>(({ size, ...target }) => {
  const { t } = useTranslation('common');
  const headerActionSmallSize = useHeaderActionSize(true);
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
      size={size ?? headerActionSmallSize}
      title={label}
      tooltipProps={{ hotkey, placement: 'bottom' }}
      onClick={() => void toggle()}
    />
  );
});

FavoriteButton.displayName = 'FavoriteButton';

export default FavoriteButton;

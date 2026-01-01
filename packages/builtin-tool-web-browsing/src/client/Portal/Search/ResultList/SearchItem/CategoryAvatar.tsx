import { Avatar, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import {
  LucideAtom,
  LucideClapperboard,
  LucideFiles,
  LucideImages,
  LucideLaptop,
  LucideMusic,
  LucideNewspaper,
  LucideShoppingBag,
  LucideTextSearch,
  LucideUserRound,
} from 'lucide-react';
import { memo, useMemo } from 'react';

interface CategoryAvatarProps {
  category: string;
  size?: number;
}

const CategoryAvatar = memo<CategoryAvatarProps>(({ category, size = 24 }) => {
  const categoryIcon = useMemo(() => {
    switch (category) {
      default:
      case 'general': {
        return LucideTextSearch;
      }
      case 'videos': {
        return LucideClapperboard;
      }
      case 'images': {
        return LucideImages;
      }
      case 'files': {
        return LucideFiles;
      }
      case 'music': {
        return LucideMusic;
      }
      case 'shopping': {
        return LucideShoppingBag;
      }
      case 'social': {
        return LucideUserRound;
      }
      case 'it': {
        return LucideLaptop;
      }
      case 'news': {
        return LucideNewspaper;
      }
      case 'science': {
        return LucideAtom;
      }
    }
  }, [category]);

  return (
    <Avatar
      avatar={<Icon icon={categoryIcon} style={{ color: cssVar.colorTextSecondary }} />}
      background={cssVar.colorFillTertiary}
      size={size}
    />
  );
});

export default CategoryAvatar;

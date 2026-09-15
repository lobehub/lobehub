'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { LockIcon } from 'lucide-react';
import { memo } from 'react';

import LibIcon from './index';
import LockedLibIcon from './Locked';

export type LibraryIconVariant = 'private' | 'restricted' | 'workspace';

export const getLibraryIconVariant = ({
  memberRestricted,
  visibility,
}: {
  memberRestricted?: boolean;
  visibility?: 'private' | 'public' | null;
}): LibraryIconVariant => {
  if (visibility === 'private') return 'private';
  if (visibility === 'public' && memberRestricted) return 'restricted';

  return 'workspace';
};

interface LibraryStatusIconProps {
  memberRestricted?: boolean;
  size?: number;
  visibility?: 'private' | 'public' | null;
}

/**
 * One semantic icon mapping for every library identity surface:
 * private → lock, member-restricted workspace library → folder + lock,
 * ordinary workspace library → folder.
 */
const LibraryStatusIcon = memo<LibraryStatusIconProps>(
  ({ memberRestricted, size = 20, visibility }) => {
    const variant = getLibraryIconVariant({ memberRestricted, visibility });

    if (variant === 'private') {
      return <Icon color={cssVar.colorTextDescription} icon={LockIcon} size={size} />;
    }
    if (variant === 'restricted') return <LockedLibIcon size={size} />;

    return <LibIcon size={size} />;
  },
);

LibraryStatusIcon.displayName = 'LibraryStatusIcon';

export default LibraryStatusIcon;

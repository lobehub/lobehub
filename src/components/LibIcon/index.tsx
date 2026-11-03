import { cssVar, Icon } from '@lobehub/ui';
import { LibraryBigIcon } from 'lucide-react';
import { memo } from 'react';

interface LibIconProps {
  size?: number;
}
/**
 * A knowledge base reads as a bookshelf, not a folder: folders are what a
 * knowledge base contains, and the two must not look alike in the same list.
 */
const LibIcon = memo<LibIconProps>(({ size = 20 }) => {
  return <Icon color={cssVar.geekblue} icon={LibraryBigIcon} size={size} />;
});

export default LibIcon;

import { Github } from '@lobehub/icons';
import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { FolderIcon, GitBranchIcon } from 'lucide-react';
import { memo } from 'react';

interface DirIconProps {
  /** Detected repo type — drives the glyph: GitHub mark, git branch, or a plain
   * folder when the type is unknown. */
  repoType?: 'git' | 'github';
  size?: number;
}

/** Directory icon shared by every cwd surface (local / device / settings pickers,
 * topic rows) so a `github` dir looks the same everywhere. */
const DirIcon = memo<DirIconProps>(({ repoType, size = 16 }) => {
  const iconStyle = { color: cssVar.colorTextTertiary, flex: 'none' as const };
  if (repoType === 'github') return <Github size={size} style={iconStyle} />;
  return (
    <Icon icon={repoType === 'git' ? GitBranchIcon : FolderIcon} size={size} style={iconStyle} />
  );
});

DirIcon.displayName = 'DirIcon';

export default DirIcon;

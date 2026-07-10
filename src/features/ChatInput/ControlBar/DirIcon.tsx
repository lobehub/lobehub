import { Github } from '@lobehub/icons';
import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { FolderGit2Icon, FolderIcon } from 'lucide-react';
import { memo } from 'react';

interface DirIconProps {
  /** Detected repo type — drives the glyph: GitHub mark, a git-tracked folder, or
   * a plain folder when the type is unknown. */
  repoType?: 'git' | 'github';
  size?: number;
}

/** Directory icon shared by every cwd surface (local / device / settings pickers,
 * topic rows) so a `github` dir looks the same everywhere.
 *
 * A plain-git dir renders a *folder* glyph, not `GitBranchIcon`: this icon names a
 * directory, and in the ControlBar it sits immediately left of the worktree switcher,
 * which owns the branch glyph. Two identical branch icons side by side read as one
 * control repeated rather than "repo" followed by "branch". */
const DirIcon = memo<DirIconProps>(({ repoType, size = 16 }) => {
  const iconStyle = { color: cssVar.colorTextTertiary, flex: 'none' as const };
  if (repoType === 'github') return <Github size={size} style={iconStyle} />;
  return (
    <Icon icon={repoType === 'git' ? FolderGit2Icon : FolderIcon} size={size} style={iconStyle} />
  );
});

DirIcon.displayName = 'DirIcon';

export default DirIcon;

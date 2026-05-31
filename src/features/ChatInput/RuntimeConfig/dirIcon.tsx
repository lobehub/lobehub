import { Github } from '@lobehub/icons';
import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { FolderIcon, GitBranchIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Render the directory icon for a detected repo type: GitHub mark, git branch,
 * or a plain folder when the type is unknown. Shared by every cwd picker so a
 * `github` dir looks the same in the local, device, and settings views. */
export const renderDirIcon = (repoType?: 'git' | 'github'): ReactNode => {
  const iconStyle = { color: cssVar.colorTextTertiary, flex: 'none' as const };
  if (repoType === 'github') return <Github size={16} style={iconStyle} />;
  return (
    <Icon icon={repoType === 'git' ? GitBranchIcon : FolderIcon} size={16} style={iconStyle} />
  );
};

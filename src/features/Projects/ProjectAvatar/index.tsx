import { Avatar } from '@lobehub/ui';
import { memo } from 'react';

export interface ProjectAvatarProps {
  /** The project's logo: an emoji or image URL. */
  avatar?: string | null;
  name: string;
  size?: number;
}

/**
 * A project's logo, or the generated avatar `@lobehub/ui` seeds from its name
 * when it has none — the same one the project switcher shows.
 */
const ProjectAvatar = memo<ProjectAvatarProps>(({ avatar, name, size = 20 }) => (
  <Avatar
    avatar={avatar || undefined}
    shape={'square'}
    size={size}
    style={{ flex: 'none' }}
    title={name}
  />
));

ProjectAvatar.displayName = 'ProjectAvatar';

export default ProjectAvatar;

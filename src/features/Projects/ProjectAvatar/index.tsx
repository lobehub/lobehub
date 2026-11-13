import { Avatar } from '@lobehub/ui';
import { memo } from 'react';

import { type ProjectAvatarSource, toProjectAvatarProps } from './seed';

export interface ProjectAvatarProps extends ProjectAvatarSource {
  size?: number;
}

/**
 * A project's logo, or the gradient `@lobehub/ui` generates from its id when it
 * has none — the same one the project switcher shows.
 */
const ProjectAvatar = memo<ProjectAvatarProps>(({ size = 20, ...source }) => (
  <Avatar {...toProjectAvatarProps(source)} shape={'square'} size={size} style={{ flex: 'none' }} />
));

ProjectAvatar.displayName = 'ProjectAvatar';

export default ProjectAvatar;

// `avatar` is an emoji or image URL, not a component: `Icon` would pass it to
// createElement as a tag name and crash the whole page.
export const projectIcon = (project: { avatar?: string | null; id: string; name: string }) => (
  <ProjectAvatar avatar={project.avatar} id={project.id} name={project.name} size={18} />
);

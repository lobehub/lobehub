'use client';

import { Icon } from '@lobehub/ui';

import AgentAvatar from '@/components/AgentAvatar';
import Avatar from '@/components/Avatar';
import WorkspaceAvatar from '@/components/WorkspaceAvatar';
import ProjectAvatar from '@/features/Projects/ProjectAvatar';
import { type ResolvedRouteMeta } from '@/spa/router/routeMeta';

import { resolveTabVisual } from './resolveTabVisual';

const AVATAR_SIZE = 16;

interface TabMetaIconProps {
  /** Applied to the route icon only; avatars keep their own sizing. */
  iconClassName?: string;
  meta: ResolvedRouteMeta;
}

/** The leading avatar or route icon of a page entry, shared by tabs and the recently-viewed menu. */
const TabMetaIcon = ({ iconClassName, meta }: TabMetaIconProps) => {
  switch (resolveTabVisual(meta)) {
    case 'agent': {
      return (
        <AgentAvatar
          agentId={meta.avatarSeed}
          avatar={meta.avatar}
          background={meta.backgroundColor}
          name={meta.title}
          size={AVATAR_SIZE}
        />
      );
    }
    case 'project': {
      return (
        <ProjectAvatar
          avatar={meta.avatar}
          id={meta.avatarSeed!}
          name={meta.title}
          size={AVATAR_SIZE}
        />
      );
    }
    case 'workspace': {
      return <WorkspaceAvatar avatar={meta.avatar} name={meta.title} size={AVATAR_SIZE} />;
    }
    case 'avatar': {
      return (
        <Avatar
          emojiScaleWithBackground
          avatar={meta.avatar}
          background={meta.backgroundColor}
          name={meta.title}
          shape="square"
          size={AVATAR_SIZE}
        />
      );
    }
    case 'icon': {
      return <Icon className={iconClassName} icon={meta.icon!} size="small" />;
    }
    default: {
      return null;
    }
  }
};

export default TabMetaIcon;

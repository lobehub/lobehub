import type { TaskDetailActivityAuthor } from '@lobechat/types';
import { memo, type ReactNode } from 'react';

import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import MemberProfilePopup from '@/features/MemberProfileCard/MemberProfilePopup';

/**
 * Hovering an activity author's name or avatar opens who they are: the Agent's
 * profile card, or a workspace member's card. Without an id (the system acted)
 * the children render unchanged, as they do for someone outside the directory.
 */
const ActivityAuthorProfile = memo<{
  author?: TaskDetailActivityAuthor | null;
  children: ReactNode;
}>(({ author, children }) => {
  if (!author?.id) return children;

  if (author.type === 'agent')
    return (
      <AgentProfilePopup
        agent={{ avatar: author.avatar, title: author.name }}
        agentId={author.id}
        trigger={'hover'}
      >
        <span style={{ display: 'inline-flex', minWidth: 0 }}>{children}</span>
      </AgentProfilePopup>
    );

  return <MemberProfilePopup userId={author.id}>{children}</MemberProfilePopup>;
});

ActivityAuthorProfile.displayName = 'ActivityAuthorProfile';

export default ActivityAuthorProfile;

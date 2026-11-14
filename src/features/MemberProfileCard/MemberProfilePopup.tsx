'use client';

import { Popover } from '@lobehub/ui';
import { memo, type PropsWithChildren, type ReactNode } from 'react';

import MemberProfileCard from '.';
import { stopCardClick } from './stopCardClick';
import { useWorkspaceMemberProfile } from './useWorkspaceMemberProfile';

const POPOVER_STYLES = { content: { borderRadius: 12, overflow: 'hidden', padding: 0 } } as const;

interface MemberProfilePopupProps extends PropsWithChildren {
  /** Rendered instead of the children when there is no member card to show. */
  fallback?: ReactNode;
  placement?: 'top' | 'right' | 'bottom' | 'left';
  userId?: string | null;
}

/**
 * Shows a workspace member's profile card when their avatar or name is hovered.
 * Outside a workspace, or for someone who is not a member, it renders
 * `fallback` (the children by default) instead. It only reads the member
 * directory: the host surface loads it once (`useFetchWorkspaceMembers`), so a
 * long list of avatars does not refetch it per row.
 */
const MemberProfilePopup = memo<MemberProfilePopupProps>(
  ({ children, fallback, placement = 'top', userId }) => {
    const member = useWorkspaceMemberProfile(userId);

    if (!member) return fallback ?? children;

    return (
      <Popover
        nativeButton={false}
        placement={placement}
        styles={POPOVER_STYLES}
        trigger={'hover'}
        content={
          <div role="presentation" onClick={stopCardClick}>
            <MemberProfileCard member={member} />
          </div>
        }
      >
        <span style={{ display: 'inline-flex', minWidth: 0 }}>{children}</span>
      </Popover>
    );
  },
);

MemberProfilePopup.displayName = 'MemberProfilePopup';

export default MemberProfilePopup;

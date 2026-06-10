interface ResolveCommunityUserAvatarTargetParams {
  isWorkspaceScope: boolean;
  profileUsername?: string | null;
}

export const resolveCommunityUserAvatarTarget = ({
  isWorkspaceScope,
  profileUsername,
}: ResolveCommunityUserAvatarTargetParams) => {
  if (isWorkspaceScope) return '/community/workspace';
  if (profileUsername) return `/community/user/${profileUsername}`;
};

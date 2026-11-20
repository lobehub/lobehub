interface ResolveCommunityUserAvatarTargetParams {
  isWorkspaceScope: boolean;
  profileUsername?: string | null;
}

export const resolveCommunityUserAvatarTarget = ({
  isWorkspaceScope,
  profileUsername,
}: ResolveCommunityUserAvatarTargetParams) => {
  if (isWorkspaceScope) return '/marketplace/workspace';
  if (profileUsername) return `/marketplace/user/${profileUsername}`;
};

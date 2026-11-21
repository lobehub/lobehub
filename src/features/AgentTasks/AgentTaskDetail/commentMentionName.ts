interface MentionProfile {
  fullName?: string | null;
  username?: string | null;
}

const profileName = (profile?: MentionProfile | null) =>
  profile?.fullName || profile?.username || undefined;

/**
 * Display name of a mention tag. Agents and the CLI often write only
 * `<mention id="user_xxx" />`, so resolve the id against the workspace members
 * and the signed-in user first (this also picks up renames), then fall back to
 * the name written in the tag, and to the raw id only as a last resort.
 */
export const resolveCommentMentionName = ({
  currentUser,
  id,
  memberProfiles,
  name,
}: {
  currentUser?: (MentionProfile & { id?: string }) | null;
  id?: string;
  memberProfiles: ReadonlyMap<string, MentionProfile>;
  name?: string;
}): string | undefined => {
  const resolved =
    id &&
    (profileName(memberProfiles.get(id)) ||
      (currentUser?.id === id ? profileName(currentUser) : undefined));

  return resolved || name || id;
};

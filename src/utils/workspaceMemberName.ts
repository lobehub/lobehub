/**
 * The name a workspace member goes by. A member may set a nickname for one
 * workspace (`workspace_members.config.nickname`); it replaces their account name
 * everywhere inside that workspace and nowhere else. Without one, the account
 * name is used: full name, then @handle, then email.
 *
 * Every client surface that lists or labels workspace members resolves the
 * name here, so a member reads the same in the directory, pickers, mentions
 * and task fields.
 */
export interface WorkspaceMemberNameSource {
  /** The membership's `config`; only `nickname` is read. */
  config?: { nickname?: string | null } | null;
  user?: {
    email?: string | null;
    fullName?: string | null;
    username?: string | null;
  } | null;
  userId: string;
}

/** The member's nickname in this workspace, or `undefined` when unset or blank. */
export const getWorkspaceMemberNickname = (member: Pick<WorkspaceMemberNameSource, 'config'>) =>
  member.config?.nickname?.trim() || undefined;

/**
 * nickname → full name → @handle → email → `fallback` (the user id by default).
 * With `emailLocalPart`, an email keeps only the part before `@`, for compact
 * labels such as initials.
 */
export const getWorkspaceMemberName = (
  member: WorkspaceMemberNameSource,
  options: { emailLocalPart?: boolean; fallback?: string } = {},
): string => {
  const profile = member.user;
  const email = profile?.email?.trim();

  return (
    getWorkspaceMemberNickname(member) ||
    profile?.fullName?.trim() ||
    profile?.username?.trim() ||
    (email && options.emailLocalPart ? email.split('@')[0] : email) ||
    (options.fallback ?? member.userId)
  );
};

/** Every name a member can be found by: nickname, full name, @handle and email. */
export const getWorkspaceMemberSearchLabels = (member: WorkspaceMemberNameSource) => [
  getWorkspaceMemberNickname(member),
  member.user?.fullName,
  member.user?.username,
  member.user?.email,
];

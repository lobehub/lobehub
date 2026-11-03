/**
 * Active identity shown in the user button / panel header. In the open-source
 * build there's only one identity (the signed-in user), so this stub returns
 * `null` everywhere — callers fall back to user data. Cloud overrides this
 * hook to return the active workspace's avatar / name when a team workspace
 * is selected, so the header reflects the current context.
 */
export interface ActiveIdentity {
  avatar?: string | null;
  name?: string | null;
}

export const useActiveIdentity = (): ActiveIdentity | null => null;

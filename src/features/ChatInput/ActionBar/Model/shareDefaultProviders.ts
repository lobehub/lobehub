interface ShareDefaultProvidersParams {
  /** `undefined` while the share status is loading or not readable. */
  isShared?: boolean;
  /** Providers a live share accepts; `undefined` when unrestricted or exempt. */
  shareProviders?: readonly string[];
  supported: boolean;
  /** The switch writes the caller's own override, which no share checks. */
  usesWorkspaceMemberSelection: boolean;
}

/**
 * Providers an in-topic switch may carry over to the agent row's default, or
 * `undefined` when any provider may. A live Agent Share rejects other providers
 * as its default, so until the share status is known to be off, a shareable
 * agent is treated as shared: the switch then stays in its topic instead of
 * attempting a write the server would refuse.
 */
export const resolveShareDefaultProviders = ({
  isShared,
  shareProviders,
  supported,
  usesWorkspaceMemberSelection,
}: ShareDefaultProvidersParams): readonly string[] | undefined =>
  shareProviders && supported && isShared !== false && !usesWorkspaceMemberSelection
    ? shareProviders
    : undefined;

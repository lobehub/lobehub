/**
 * How much storage this caller may keep in a persistent sandbox workspace, in
 * bytes. `null` means no persistent workspace — the sandbox stays ephemeral,
 * which is the default and the only behaviour the open-source build has.
 *
 * A deployment that offers persistent workspaces overrides this module to
 * answer from whatever it uses to decide entitlements.
 *
 * Only the size lives behind this slot. The directory NAME comes from the
 * caller's identity via `deriveSandboxWorkspaceKey`; it is not a deployment
 * decision and must stay identical on both sides of the claim.
 */
export const resolveSandboxWorkspaceQuotaBytes = async (_params: {
  userId: string;
  /** Organization workspace the run is scoped to; it is judged, not the acting member. */
  workspaceId?: string | null;
}): Promise<number | null> => null;

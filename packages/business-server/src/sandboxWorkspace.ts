/**
 * What this caller is entitled to in a persistent sandbox workspace, or `null`
 * for no persistent workspace at all — the sandbox stays ephemeral, which is
 * the default and the only behaviour the open-source build has.
 *
 * A deployment that offers persistent workspaces overrides this module to
 * answer from whatever it uses to decide entitlements.
 *
 * Only the entitlement lives behind this slot. The directory NAME comes from
 * the caller's identity via `deriveSandboxWorkspaceKey`; it is not a deployment
 * decision and must stay identical on both sides of the claim.
 */
export interface SandboxWorkspaceEntitlement {
  /**
   * Whether writes past {@link quotaBytes} are allowed and billed, rather than
   * refused. Whatever decides that — a plan, a consent, a payment method, a
   * spending cap — is the deployment's business; the execution plane is told
   * the answer, never the inputs.
   *
   * Omitted means no, which is the answer that cannot charge anyone by
   * mistake.
   */
  overageAllowed?: boolean;
  /** How much storage the caller may keep, in bytes. */
  quotaBytes: number;
}

export const resolveSandboxWorkspaceEntitlement = async (_params: {
  userId: string;
  /** Organization workspace the run is scoped to; it is judged, not the acting member. */
  workspaceId?: string | null;
}): Promise<SandboxWorkspaceEntitlement | null> => null;

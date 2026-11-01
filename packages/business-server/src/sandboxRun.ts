/**
 * How many one-shot sandbox runs (widget scripts) this caller may have in
 * flight at once, or `null` to leave it to the execution plane's default —
 * which is the only behaviour the open-source build has.
 *
 * A deployment that sells more concurrency overrides this module to answer
 * from whatever it uses to decide entitlements. The answer is signed onto the
 * trusted-client token as the `sandboxRun` claim; the execution plane still
 * applies its own ceiling, so this can only ask for up to what it allows.
 */
export interface SandboxRunLimits {
  /** Concurrent one-shot runs allowed for the account; a positive integer. */
  maxConcurrency: number;
}

export const resolveSandboxRunLimits = async (_params: {
  userId: string;
  /** Organization workspace the run is scoped to; it is judged, not the acting member. */
  workspaceId?: string | null;
}): Promise<SandboxRunLimits | null> => null;

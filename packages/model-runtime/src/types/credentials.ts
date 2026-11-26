/**
 * Result of `LobeRuntimeAI.checkCredentials`: the key was accepted.
 * A rejected key throws an `AgentRuntimeError` instead.
 */
export interface CheckCredentialsResult {
  /** Remaining balance or credits the provider reported, when it reports one. */
  balance?: number;
}

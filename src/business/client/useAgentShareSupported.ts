/**
 * Business slot: whether the Agent Share surface applies to an agent.
 *
 * Agent sharing runs a visitor's conversation on the creator's account and
 * bills it to them, so the surface ships only where that accounting exists.
 * This open-source default reports "not supported", which hides every share
 * entry point (profile tab, header action, settings page).
 */

export interface AgentShareSupport {
  /** Whether this agent currently has an active link share. */
  isShared: boolean | undefined;
  /** Whether a *new* share may be published right now. */
  publishable: boolean;
  /** Whether the agent's effective model provider may be shared. */
  shareModelAllowed: boolean;
  /** Whether the share management surface applies to this agent at all. */
  supported: boolean;
  /**
   * Whether the share entry should be shown: `true` when it may publish or
   * already has a live share to revoke, `undefined` while still resolving.
   */
  visible: boolean | undefined;
}

const UNSUPPORTED: AgentShareSupport = {
  isShared: false,
  publishable: false,
  shareModelAllowed: true,
  supported: false,
  visible: false,
};

export const useAgentShareSupported = (_agentId?: null | string): AgentShareSupport => UNSUPPORTED;

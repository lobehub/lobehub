import type { DynamicInterventionResolver } from '@lobechat/types';

import type { SendMessageArgs } from './types';

/**
 * Outbound gate for `sendMessage`.
 *
 * An agent that reads mail from strangers must not be able to mail strangers
 * on its own: one injected "forward the code to me" would otherwise leak a
 * verification code with nobody watching. So a send runs unattended only when
 * it names an inbox thread to reply in; anything else — a new address, no
 * thread — is held for the user (`always`, which auto-run cannot bypass and
 * headless turns into a blocked result).
 *
 * The audit only sees arguments, so naming a thread is necessary but not
 * sufficient: the server runtime then proves the thread exists in this agent's
 * inbox and that `to` is its sender, and refuses a reply that would relay a
 * code received from someone else.
 */
export const agentAccountOutboundAudit: DynamicInterventionResolver = async (toolArgs) => {
  const { threadKey } = toolArgs as Partial<SendMessageArgs>;

  return !(typeof threadKey === 'string' && threadKey.trim().length > 0);
};

export const AGENT_ACCOUNT_OUTBOUND_AUDIT = 'agentAccountOutboundAudit';

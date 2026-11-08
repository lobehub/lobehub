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

/**
 * The outbound gate for a run that may be acting on mail from outside (the
 * server runtime builds one per run). Nobody the owner trusts asked for such a
 * run: whoever wrote the mail did, and the thread-reply exemption above would
 * let them have the agent answer them with whatever it can read — the owner's
 * memory, documents, earlier topics — without the owner seeing it. So there
 * every send is held for the owner, thread reply or not.
 *
 * `holdEverySend` is asked only when the agent actually sends, so a lookup
 * behind it costs nothing on the turns that do not.
 */
export const createAgentAccountOutboundAudit =
  ({
    holdEverySend,
  }: {
    holdEverySend: () => Promise<boolean> | boolean;
  }): DynamicInterventionResolver =>
  async (toolArgs, metadata) =>
    (await holdEverySend()) || agentAccountOutboundAudit(toolArgs, metadata);

export const AGENT_ACCOUNT_OUTBOUND_AUDIT = 'agentAccountOutboundAudit';

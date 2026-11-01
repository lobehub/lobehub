import { LobeAgentApiName, LobeAgentIdentifier } from './types';

/**
 * Whether a tool call is `lobe-agent.callSubAgent` — the only call whose
 * result carries the sub-agent reference and whose sub-agent can be continued
 * (`callAgent` children and group members cannot).
 */
export const isCallSubAgentCall = (
  plugin?: { apiName?: string | null; identifier?: string | null } | null,
): boolean =>
  plugin?.identifier === LobeAgentIdentifier && plugin.apiName === LobeAgentApiName.callSubAgent;

/**
 * Trailer appended to every server `callSubAgent` tool result. It is the
 * parent model's only handle on the sub-agent it just ran: passing the id back
 * as `callSubAgent({ subAgentId })` sends that same sub-agent a new turn on its
 * preserved history (continue after a failure, hand over partial findings,
 * follow-up questions). The id is the sub-agent's isolation thread id.
 *
 * The chat UI strips the trailer before rendering the result.
 */
/**
 * Starts at the literal tag instead of a leading `\s*`: an unanchored leading
 * `\s*` backtracks quadratically on long whitespace runs (CodeQL
 * js/polynomial-redos). Whitespace before the tag is trimmed in code instead.
 */
const SUB_AGENT_REFERENCE_PATTERN = /<sub_agent id="[^"]*" \/>\s*$/;

export const stripSubAgentReference = (content: string): string => {
  const match = SUB_AGENT_REFERENCE_PATTERN.exec(content);
  if (!match) return content;

  return content.slice(0, match.index).trimEnd();
};

export const appendSubAgentReference = (content: string, subAgentId: string): string => {
  const body = stripSubAgentReference(content);
  const reference = `<sub_agent id="${subAgentId}" />`;

  return body ? `${body}\n\n${reference}` : reference;
};

/**
 * Tool result of a background call (`callSubAgent` / `callAgent` with
 * `runInBackground`) — what the parent sees in place of the answer, which
 * arrives later as a message of its own. `subAgentId` is appended as the
 * follow-up handle when the sub-agent can be continued (`callSubAgent` only).
 */
export const buildBackgroundSubAgentReceipt = (subAgentId?: string): string => {
  const receipt =
    'Started in the background. The result will be delivered to you as a new message when it finishes — do not wait or poll for it. Continue with other work, or end your turn and tell the user what is running.';
  return subAgentId ? appendSubAgentReference(receipt, subAgentId) : receipt;
};

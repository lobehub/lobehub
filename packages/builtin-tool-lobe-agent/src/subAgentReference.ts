import { LobeAgentApiName, LobeAgentIdentifier } from './types';

/**
 * The retired `lobe-agent-management.callAgent`, now an alias that forwards to
 * `callSubAgent({ agentId })`. Spelled out here because `lobe-agent` must not
 * depend on the agent-management package. History, cached tool lists and the
 * alias itself still produce calls under this name.
 */
const LEGACY_CALL_AGENT = { apiName: 'callAgent', identifier: 'lobe-agent-management' } as const;

/** Whether a tool call is the retired `lobe-agent-management.callAgent` alias. */
export const isLegacyCallAgentCall = (
  plugin?: { apiName?: string | null; identifier?: string | null } | null,
): boolean =>
  plugin?.identifier === LEGACY_CALL_AGENT.identifier &&
  plugin.apiName === LEGACY_CALL_AGENT.apiName;

/**
 * Whether a tool call hands work to a sub-agent whose result carries the
 * sub-agent reference and which can be continued or cancelled:
 * `lobe-agent.callSubAgent` (with or without `agentId`), or the legacy
 * `lobe-agent-management.callAgent` (group members are not).
 */
export const isCallSubAgentCall = (
  plugin?: { apiName?: string | null; identifier?: string | null } | null,
): boolean =>
  (plugin?.identifier === LobeAgentIdentifier &&
    plugin.apiName === LobeAgentApiName.callSubAgent) ||
  isLegacyCallAgentCall(plugin);

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
 * Tool result of a background `callSubAgent({ runInBackground })` — what the
 * parent sees in place of the answer, which arrives later as a message of its
 * own. `subAgentId` is appended as the follow-up handle.
 */
export const buildBackgroundSubAgentReceipt = (subAgentId?: string): string => {
  const receipt =
    'Started in the background. The result will be delivered to you as a new message when it finishes — do not wait or poll for it. Continue with other work, or end your turn and tell the user what is running.';
  return subAgentId ? appendSubAgentReference(receipt, subAgentId) : receipt;
};

/**
 * Tool result of `callSubAgent({ subAgentId })` sent to a sub-agent that is
 * still running: the instruction joins that run instead of starting a new one,
 * so the answer comes the way the running call already reports it.
 */
export const buildSteeredSubAgentReceipt = (subAgentId: string): string =>
  appendSubAgentReference(
    'The sub-agent is still running, so this instruction was queued for it. It reads it at its next step and continues with it in mind; its result arrives the way its running call reports it — do not wait or poll for it here.',
    subAgentId,
  );

/**
 * Appended to every result of the `callAgent` alias, so a model still calling
 * it from an old prompt or cached tool list moves to the new interface.
 */
export const LEGACY_CALL_AGENT_NOTE =
  'Note: `callAgent` is retired and will be removed. Next time, hand work to another agent with the lobe-agent `callSubAgent` tool and its `agentId`.';

/**
 * Add {@link LEGACY_CALL_AGENT_NOTE} to a `callAgent` alias result, before the
 * `<sub_agent>` trailer so that stays the last thing in the content.
 */
export const withLegacyCallAgentNote = (content: string): string => {
  const match = SUB_AGENT_REFERENCE_PATTERN.exec(content);
  const body = match ? content.slice(0, match.index).trimEnd() : content;
  const noted = body ? `${body}\n\n${LEGACY_CALL_AGENT_NOTE}` : LEGACY_CALL_AGENT_NOTE;

  return match ? `${noted}\n\n${match[0].trim()}` : noted;
};

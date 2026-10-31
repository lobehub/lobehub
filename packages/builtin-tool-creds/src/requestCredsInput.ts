import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type { RequestCredsInputParams, RequestCredsInputState } from './types';

/**
 * Tool result of an approved `requestCredsInput` call.
 *
 * The secure form writes the values to the credential store before it
 * approves the call, so by the time the tool runs the only thing left to report
 * is whether the key now exists. Built from the request arguments and that
 * lookup alone, the result cannot carry a secret.
 *
 * Invariant (T-675): the card path ALWAYS saves the secret before it approves,
 * and skipping never executes the tool. So a not-found result here is a
 * deterministic verdict that the form was bypassed — the call was approved
 * without the card (review/push/notification client, or an approve-all race).
 * The result must not invite a blind retry: that turns one dead-end into a
 * loop of dead-ends (user case リキ retried 4 times with identical failures).
 * It must not advertise a reopenable card either: once the intervention
 * resolves, the pending card is gone — Tool Detail only sends *pending*
 * interventions to the InterventionBar and renders completed calls as results
 * (src/features/Conversation/Messages/AssistantGroup/Tool/Detail/index.tsx),
 * so a card-guided "working path" would be another dead end (Codex P2 on
 * PR #20701). The only still-actionable path is manual entry in Settings.
 * The missing form-backed approval capability is tracked in LOBE-14592.
 */
export const buildRequestCredsInputResult = (
  args: Pick<RequestCredsInputParams, 'key' | 'name'>,
  found: boolean,
): BuiltinServerRuntimeOutput => {
  if (!found) {
    return {
      content:
        `The approval for "${args.key}" went through without the secure form rendering, so no credential was stored — retrying requestCredsInput will fail the same way until a form-backed approval happens.\n\n` +
        `Do NOT call requestCredsInput again for this key, and do NOT ask the user to paste the secret into the chat. There is no reopenable card for this call: once the approval resolves, the pending credential card is gone. The only working path is manual entry:\n` +
        `Ask the user to add the credential manually: Settings → Credentials, key "${args.key}"` +
        `${args.name ? ` ("${args.name}")` : ''} — values stay encrypted and never reach this chat.\n` +
        `After the user confirms it is saved, verify with injectCredsToSandbox or a read-only credential lookup instead of calling requestCredsInput again.`,
      error: {
        message: `Credential not found: ${args.key}`,
        type: 'CredentialNotFound',
      },
      success: false,
    };
  }

  const state: RequestCredsInputState = { key: args.key };

  return {
    content: `Credential "${args.name || args.key}" is saved under key "${args.key}". The user entered its values in a secure form; they are encrypted and not visible to you. Refer to the credential by its key.`,
    state,
    success: true,
  };
};

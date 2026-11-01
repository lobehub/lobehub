import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type { RequestCredsInputParams, RequestCredsInputState } from './types';

/**
 * Tool result of an approved `requestCredsInput` call.
 *
 * The secure form writes the values to the credential store before it
 * approves the call, so by the time the tool runs the only thing left to report
 * is whether the key now exists. Built from the request arguments and that
 * lookup alone, the result cannot carry a secret.
 */
export const buildRequestCredsInputResult = (
  args: Pick<RequestCredsInputParams, 'key' | 'name'>,
  found: boolean,
): BuiltinServerRuntimeOutput => {
  if (!found) {
    return {
      content: `No credential with key "${args.key}" was found, so the user did not complete the secure form. Do not ask for the secret in the chat. Call requestCredsInput again only if the user asks to.`,
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

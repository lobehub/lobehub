const randomClientId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let clientId: string | undefined;

/**
 * This page's id towards the Agent Gateway and the LLM relay.
 *
 * One value per page load, shared by the multiplexed socket (`?clientId=`),
 * the v1 socket's `auth` message and `execAgent`'s `llmExecutor.clientId`, so
 * the gateway can hand a run's `llm_execute` to the tab that started it. A
 * reload is a new client on purpose: the old page's in-flight attempts died
 * with it.
 */
export const getLlmRelayClientId = (): string => {
  clientId ??= randomClientId();
  return clientId;
};

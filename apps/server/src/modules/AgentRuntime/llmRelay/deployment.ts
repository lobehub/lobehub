import { appEnv } from '@/envs/app';

/**
 * Whether this deployment can relay an LLM call to a browser tab: it pushes to
 * an Agent Gateway (URL + service token). Redis, which relayed calls run
 * through, is a hard requirement of the app, so it is not checked here.
 * Exposed to the browser (`llmRelayAvailable`) so a tab only asks for the
 * relay where the server can actually deliver it.
 */
export const isLlmRelayDeploymentReady = (): boolean =>
  !!(appEnv.AGENT_GATEWAY_INTERNAL_URL || appEnv.AGENT_GATEWAY_URL) &&
  !!appEnv.AGENT_GATEWAY_SERVICE_TOKEN;

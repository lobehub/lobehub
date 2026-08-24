import type { ModelRuntimeHooks } from '@lobechat/model-runtime';

/** Optional request metadata forwarded to a business runtime implementation. */
export interface BusinessModelRuntimeContext {
  /**
   * Present when this LLM call serves a shared-agent visitor conversation.
   * A business implementation bills the agent's share budget (creator-funded)
   * instead of the executing user's personal budget.
   */
  agentShare?: { agentId: string };
  /** OAuth client id when the request was authenticated via an OIDC access token. */
  oidcClientId?: string;
}

export function getBusinessModelRuntimeHooks(
  _userId: string,
  _provider: string,
  _workspaceId?: string,
  _context?: BusinessModelRuntimeContext,
): ModelRuntimeHooks | undefined {
  return undefined;
}

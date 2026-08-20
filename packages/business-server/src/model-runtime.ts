import type { ModelRuntimeHooks } from '@lobechat/model-runtime';

/** Optional request metadata forwarded to a business runtime implementation. */
export interface BusinessModelRuntimeContext {
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

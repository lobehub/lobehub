import type { AuthContext } from '@lobechat/trpc/lambda/context';
import type {
  AgentShareAuthorizationObserver,
  AgentShareAuthorizationSource,
} from '@lobechat/types';

/**
 * Optional business hook: the observer handed to the share mutations one request makes (see
 * `AgentShareAuthorizationObserver`), given the request's context and the surface it came from.
 *
 * Default: no observer, so share mutations run without one.
 */
export const createAgentShareAuthorizationObserver = (
  _request: AuthContext,
  _source: AgentShareAuthorizationSource,
): AgentShareAuthorizationObserver | undefined => undefined;

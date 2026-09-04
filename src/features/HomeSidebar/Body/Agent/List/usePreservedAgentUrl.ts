import { useRouterStore } from '@/store/router';

import { resolvePreservedAgentUrl } from './preservedAgentUrl';

export { resolvePreservedAgentUrl } from './preservedAgentUrl';

export const usePreservedAgentUrl = (agentId: string): string =>
  useRouterStore((state) => resolvePreservedAgentUrl(state.location.pathname, agentId));

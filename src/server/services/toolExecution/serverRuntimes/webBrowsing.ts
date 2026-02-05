import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { WebBrowsingExecutionRuntime } from '@lobechat/builtin-tool-web-browsing/executionRuntime';

import { SearchService } from '@/server/services/search';

import type {ServerRuntimeRegistration} from './types';

// Pre-instantiated (no per-request context needed)
const runtime = new WebBrowsingExecutionRuntime({
  searchService: new SearchService(),
});

/**
 * WebBrowsing Server Runtime
 * Pre-instantiated runtime (no per-request context needed)
 */
export const webBrowsingRuntime: ServerRuntimeRegistration = {
  factory: () => runtime,
  identifier: WebBrowsingManifest.identifier,
};

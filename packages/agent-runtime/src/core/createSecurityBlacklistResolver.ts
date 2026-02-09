import type { DynamicInterventionResolver, GlobalInterventionResolverConfig } from '@lobechat/types';

import { DEFAULT_SECURITY_BLACKLIST } from './defaultSecurityBlacklist';
import { InterventionChecker } from './InterventionChecker';

export const SECURITY_BLACKLIST_RESOLVER_TYPE = 'securityBlacklist';

/**
 * Create a DynamicInterventionResolver that checks security blacklist rules.
 * Reads blacklist from `metadata.securityBlacklist`, falls back to DEFAULT_SECURITY_BLACKLIST.
 */
export const createSecurityBlacklistResolver = (): DynamicInterventionResolver => {
  return (toolArgs: Record<string, any>, metadata?: Record<string, any>): boolean => {
    const securityBlacklist = metadata?.securityBlacklist ?? DEFAULT_SECURITY_BLACKLIST;
    const result = InterventionChecker.checkSecurityBlacklist(securityBlacklist, toolArgs);
    return result.blocked;
  };
};

/**
 * Create the default security blacklist global resolver config.
 * policy: 'always' ensures this cannot be bypassed by auto-run mode.
 */
export const createSecurityBlacklistGlobalResolver = (): GlobalInterventionResolverConfig => ({
  policy: 'always',
  resolver: createSecurityBlacklistResolver(),
  type: SECURITY_BLACKLIST_RESOLVER_TYPE,
});

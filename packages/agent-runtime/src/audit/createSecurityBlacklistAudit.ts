import {
  type DynamicInterventionResolver,
  type GlobalInterventionAuditConfig,
} from '@lobechat/types';

import { InterventionChecker } from '../core/InterventionChecker';
import { DEFAULT_SECURITY_BLACKLIST } from './defaultSecurityBlacklist';

export const SECURITY_BLACKLIST_AUDIT_TYPE = 'securityBlacklist';

/**
 * Create a DynamicInterventionResolver that checks security blacklist rules.
 * Reads blacklist from `metadata.securityBlacklist`, falls back to DEFAULT_SECURITY_BLACKLIST.
 */
export const createSecurityBlacklistAudit = (): DynamicInterventionResolver => {
  return (toolArgs: Record<string, any>, metadata?: Record<string, any>): boolean => {
    const securityBlacklist = metadata?.securityBlacklist ?? DEFAULT_SECURITY_BLACKLIST;
    const result = InterventionChecker.checkSecurityBlacklist(securityBlacklist, toolArgs);
    return result.blocked;
  };
};

/**
 * Create the default security blacklist global audit config.
 * policy: 'always' ensures this cannot be bypassed by auto-run mode.
 */
export const createSecurityBlacklistGlobalAudit = (): GlobalInterventionAuditConfig => ({
  policy: 'always',
  resolver: createSecurityBlacklistAudit(),
  type: SECURITY_BLACKLIST_AUDIT_TYPE,
});

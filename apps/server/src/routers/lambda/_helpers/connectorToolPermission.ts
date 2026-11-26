import { humanInterventionMayResolveTo } from '@lobechat/const/plugin';

import { ConnectorToolPermission } from '@/database/schemas';

const APPROVAL_POLICIES = ['required', 'always'] as const;

const requiresApproval = (policy: unknown) =>
  (APPROVAL_POLICIES as readonly unknown[]).includes(policy);

/**
 * Map a builtin or plugin manifest's humanIntervention → default
 * ConnectorToolPermission. Their manifests keep their own rules at run time.
 */
export function resolveDefaultPermission(humanIntervention: unknown): ConnectorToolPermission {
  return requiresApproval(humanIntervention)
    ? ConnectorToolPermission.needs_approval
    : ConnectorToolPermission.auto;
}

/**
 * Map a manifest tool's humanIntervention → the default permission of the
 * connector tool that carries it from now on. The connector's manifest is
 * built from that one permission, so argument rules and dynamic resolvers
 * cannot survive: one that can ask for approval makes every call need it.
 * One that can ask for `always` also marks the tool's metadata
 * (`withMandatoryApprovalMark`), which keeps it past auto-run.
 */
export function resolveConnectorToolPermission(
  humanIntervention: unknown,
): ConnectorToolPermission {
  return humanInterventionMayResolveTo(humanIntervention, APPROVAL_POLICIES)
    ? ConnectorToolPermission.needs_approval
    : ConnectorToolPermission.auto;
}

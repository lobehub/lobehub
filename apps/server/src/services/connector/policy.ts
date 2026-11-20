import {
  loadTenantSettings,
  type TenantConnectorPolicy,
} from '@lobechat/business-config/tenant-settings';
import { TRPCError } from '@trpc/server';

/**
 * Why a connector write breaks the tenant's connector policy:
 * - `custom_disabled`: members may not add, edit or authorize custom connectors;
 * - `blocked`: the identifier is on the blocklist;
 * - `not_allowlisted`: an allowlist exists and the identifier is not on it.
 */
export type ConnectorPolicyViolation = 'blocked' | 'custom_disabled' | 'not_allowlisted';

export interface ConnectorPolicyTarget {
  identifier: string;
  /** `user_connectors.source_type`; a `customPlugin` row counts as `custom`. */
  sourceType: string;
}

/**
 * Built-in tools are never restricted. Custom connectors follow the switch
 * alone (their identifiers are generated); marketplace connectors follow the
 * blocklist, then the allowlist when it is non-empty.
 */
export const evaluateConnectorPolicy = (
  policy: TenantConnectorPolicy | undefined,
  target: ConnectorPolicyTarget,
): ConnectorPolicyViolation | undefined => {
  if (!policy || target.sourceType === 'builtin') return;
  if (target.sourceType === 'custom')
    return policy.allowCustomConnectors ? undefined : 'custom_disabled';
  if (policy.blocklist.includes(target.identifier)) return 'blocked';
  if (policy.allowlist.length > 0 && !policy.allowlist.includes(target.identifier))
    return 'not_allowlisted';
};

/** The current tenant's policy; `undefined` outside business builds or before Admin saves one. */
export const getConnectorPolicy = async (): Promise<TenantConnectorPolicy | undefined> =>
  (await loadTenantSettings())?.connectorPolicy;

const MESSAGES: Record<ConnectorPolicyViolation, string> = {
  blocked: 'This connector is blocked by your organization.',
  custom_disabled: 'Your organization does not allow members to add custom connectors.',
  not_allowlisted: 'This connector is not on your organization’s allowlist.',
};

/**
 * Rejects a connector write the tenant's policy does not allow. The server is
 * the enforcement point: hiding an entry in the UI does not stop a direct call.
 */
export const assertConnectorAllowed = async (target: ConnectorPolicyTarget): Promise<void> => {
  const violation = evaluateConnectorPolicy(await getConnectorPolicy(), target);
  if (violation) throw new TRPCError({ code: 'FORBIDDEN', message: MESSAGES[violation] });
};

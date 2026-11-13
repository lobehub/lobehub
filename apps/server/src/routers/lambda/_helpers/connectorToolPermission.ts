import { ConnectorToolPermission } from '@/database/schemas';

const requiresApproval = (policy: unknown) => policy === 'required' || policy === 'always';

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
 */
export function resolveConnectorToolPermission(
  humanIntervention: unknown,
): ConnectorToolPermission {
  const rules = Array.isArray(humanIntervention) ? humanIntervention : [humanIntervention];
  return rules.some(ruleMayRequireApproval)
    ? ConnectorToolPermission.needs_approval
    : ConnectorToolPermission.auto;
}

/**
 * Whether one policy, rule or dynamic config can ask for approval. A dynamic
 * config's resolver does not run on a connector, so either outcome counts: its
 * `policy` (`always` when unset) on a match, its `default` otherwise.
 */
function ruleMayRequireApproval(rule: unknown): boolean {
  if (!rule || typeof rule !== 'object') return requiresApproval(rule);

  const { dynamic, policy } = rule as { dynamic?: unknown; policy?: unknown };
  if (dynamic && typeof dynamic === 'object') {
    const { default: fallback, policy: onMatch = 'always' } = dynamic as {
      default?: unknown;
      policy?: unknown;
    };
    return requiresApproval(onMatch) || requiresApproval(fallback);
  }
  return requiresApproval(policy);
}

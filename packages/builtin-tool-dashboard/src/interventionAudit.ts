import type {
  DynamicInterventionResolver,
  WidgetDryRunGrant,
  WidgetManifest,
} from '@lobechat/types';

/** Registry key of the `dryRunWidget` approval audit (see `dynamicInterventionAudits`). */
export const DASHBOARD_DRY_RUN_AUDIT = 'dashboardDryRunAudit';

/**
 * A draft that reads connector credentials or reaches the network can act on
 * the user's behalf (mutate, exfiltrate) the moment it runs, so running it —
 * even as a dry run — needs the user's approval. A draft with neither runs in
 * a sandbox with no secrets and no network and may run unattended.
 */
export const dryRunNeedsApproval = (manifest: WidgetManifest | null | undefined) =>
  !!manifest &&
  ((manifest.env ?? []).some((item) => !!item.connector) ||
    (manifest.network?.allow ?? []).length > 0);

/** The access a version asks for: the connectors it reads and the hosts it calls. */
export const dryRunAccessOf = (manifest: WidgetManifest | null | undefined) => ({
  connectors: [
    ...new Set(
      (manifest?.env ?? []).map((item) => item.connector?.trim()).filter((c): c is string => !!c),
    ),
  ].sort(),
  hosts: [
    ...new Set(
      (manifest?.network?.allow ?? []).map((host) => host.trim().toLowerCase()).filter(Boolean),
    ),
  ].sort(),
});

/**
 * Whether one standing grant of the version's own level (personal space or
 * its workspace) covers every connector and host the version asks for.
 * Access is never pooled across grants: approving GitHub-with-its-API and,
 * separately, an unrelated host must not let a script send the GitHub token
 * to that host.
 */
export const isDryRunAccessGranted = (
  manifest: WidgetManifest | null | undefined,
  grants: WidgetDryRunGrant[] | null | undefined,
  workspaceId: string | null | undefined,
) => {
  const access = dryRunAccessOf(manifest);
  const level = workspaceId ?? null;
  return (grants ?? []).some(
    (grant) =>
      (grant.workspaceId ?? null) === level &&
      access.connectors.every((connector) => grant.connectors.includes(connector)) &&
      access.hosts.every((host) => grant.hosts.includes(host)),
  );
};

export interface DryRunAuditOptions {
  /** The user's standing dry-run grants; without it every gated dry run asks. */
  loadGrants?: () =>
    Promise<WidgetDryRunGrant[] | null | undefined> | WidgetDryRunGrant[] | null | undefined;
  /**
   * The manifest of one version of a widget the caller may author;
   * `undefined` when the version cannot be found.
   */
  loadVersion?: (
    widgetId: string,
    versionId: string,
  ) => Promise<{ manifest?: WidgetManifest | null; workspaceId?: string | null } | undefined>;
}

/**
 * Decide whether a `dryRunWidget` call needs approval by reading the exact
 * version it names: a closed draft, or one whose access a standing grant
 * covers, runs unattended. Fails closed: without a pinned version, a loader,
 * or a readable version — or when the grants cannot be read — it asks.
 */
export const createDryRunAudit =
  ({ loadGrants, loadVersion }: DryRunAuditOptions = {}): DynamicInterventionResolver =>
  async (toolArgs) => {
    const { versionId, widgetId } = toolArgs ?? {};
    if (typeof widgetId !== 'string' || typeof versionId !== 'string' || !loadVersion) return true;
    try {
      const version = await loadVersion(widgetId, versionId);
      if (!version) return true;
      if (!dryRunNeedsApproval(version.manifest)) return false;
      if (!loadGrants) return true;
      const grants = await loadGrants();
      return !isDryRunAccessGranted(version.manifest, grants, version.workspaceId);
    } catch {
      return true;
    }
  };

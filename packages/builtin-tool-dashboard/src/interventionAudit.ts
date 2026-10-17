import type { DynamicInterventionResolver, WidgetManifest } from '@lobechat/types';

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

export interface DryRunAuditOptions {
  /**
   * The manifest of one version of a widget the caller may author;
   * `undefined` when the version cannot be found.
   */
  loadVersion?: (
    widgetId: string,
    versionId: string,
  ) => Promise<{ manifest?: WidgetManifest | null } | undefined>;
}

/**
 * Decide whether a `dryRunWidget` call needs approval by reading the exact
 * version it names. Fails closed: without a pinned version, a loader, or a
 * readable version, it asks the user.
 */
export const createDryRunAudit =
  ({ loadVersion }: DryRunAuditOptions = {}): DynamicInterventionResolver =>
  async (toolArgs) => {
    const { versionId, widgetId } = toolArgs ?? {};
    if (typeof widgetId !== 'string' || typeof versionId !== 'string' || !loadVersion) return true;
    try {
      const version = await loadVersion(widgetId, versionId);
      if (!version) return true;
      return dryRunNeedsApproval(version.manifest);
    } catch {
      return true;
    }
  };

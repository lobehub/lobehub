import { ConnectorToolPermission } from '@/database/schemas';

/**
 * Patch a tool manifest's `api[]` with connector tool permissions.
 *
 * Pure (no DB / server imports) so it can run on BOTH the server runtime and the
 * classic client chat path. The 'disabled' hard-block is enforced separately at
 * execution time (ToolExecutionService / mcp router); this surfaces the
 * permission to the model and the client approval prompt.
 *
 * - needs_approval → humanIntervention: 'required'  (approval prompt)
 * - disabled       → blocking description + humanIntervention: 'required'
 */
export function patchManifestWithPermissions<
  M extends {
    api: Array<{
      description?: string;
      humanIntervention?: unknown;
      name: string;
      [k: string]: unknown;
    }>;
  },
>(manifest: M, toolPermissions: Map<string, ConnectorToolPermission>): M {
  const patchedApi = manifest.api.map((api) => {
    const permission = toolPermissions.get(api.name);
    if (permission === ConnectorToolPermission.disabled) {
      return {
        ...api,
        description:
          `[TOOL DISABLED] The user has disabled this tool and it cannot be executed. ` +
          `Do NOT call this tool. If the user asks to perform this action, inform them ` +
          `that they have manually disabled "${api.name}" and can re-enable it in Settings > Connectors.`,
        humanIntervention: 'required' as const,
      };
    }
    if (permission === ConnectorToolPermission.needs_approval) {
      return { ...api, humanIntervention: 'required' as const };
    }
    return api;
  });
  return { ...manifest, api: patchedApi };
}

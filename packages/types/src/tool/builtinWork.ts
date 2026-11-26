import { z } from 'zod';

/**
 * Lifecycle action a tool API performs on its Work resource. Drives the Work
 * version `role` (`create`/`update` → `created`/`updated`) and, for `delete`,
 * routes to the resource's delete path instead of a version upsert.
 */
export type PluginApiWorkAction = 'create' | 'delete' | 'update';

/**
 * The Work resource kind an API produces. Selects the framework-side identity
 * extractor and the `WorkModel` register method used by the dispatch layer.
 */
export type PluginApiWorkResourceType = 'document' | 'task';

/**
 * Declarative Work-registration config on a builtin tool API.
 *
 * Presence of this field is the single source of truth for "this API produces a
 * Work". The tool-execution dispatch layers (server `BuiltinToolsExecutor` /
 * client `invokeExecutor`) read it after a successful call, extract the resource
 * identity from the result/args, and register the Work version — so tools need
 * zero imperative registration code.
 *
 * Like `humanIntervention`, this is framework-only config: the model tools
 * schema conversion only reads `name`/`description`/`parameters`, so `work`
 * never leaks into the LLM-facing tool spec.
 */
export interface PluginApiWorkConfig {
  action: PluginApiWorkAction;
  /**
   * Mark the Works this API creates as agent-written. Defaults to false: an
   * automatically collected Work stays read-only to the agent. Applied only
   * when the call creates the Work identity; editability never changes
   * afterwards.
   *
   * `lh work update` / `delete` and the `lobe-work` tool change only file, link
   * and collection Works, so on the document and task Works this API creates
   * the flag records intent for a future policy and grants nothing today.
   *
   * Field-level policy for the agent belongs on this config too, so a future
   * system-owned field (for example a price) is declared here rather than
   * special-cased in each write path.
   */
  agentEditable?: boolean;
  resourceType: PluginApiWorkResourceType;
}

export const PluginApiWorkConfigSchema = z.object({
  action: z.enum(['create', 'update', 'delete']),
  agentEditable: z.boolean().optional(),
  resourceType: z.enum(['document', 'task']),
});

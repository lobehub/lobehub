import {
  LOBE_AGENT_SUB_AGENT_APIS,
  LobeAgentIdentifier,
  systemPromptWithoutSubAgent,
} from '@lobechat/builtin-tool-lobe-agent';
import { PLUGIN_SCHEMA_SEPARATOR } from '@lobechat/const';

import { pruneArrayInPlace } from './toolSetMutation';
import type { ShareGateToolSet } from './types';

/**
 * Sub-agent dispatch is not available in shared visitor runs. This strip runs
 * unconditionally on `lobe-agent`, independent of whether the manifest was
 * resolved through the normal context-aware path, so a whitelisted entry can
 * never surface `callSubAgent` / `cancelSubAgent` — nor a `systemRole` that instructs the model
 * to call it — to a share visitor's model or the activator. `lobe-agent`
 * already ships a precise systemRole variant without the dispatch section
 * (`systemPromptWithoutSubAgent`, also used by its own context-aware
 * `resolveManifest`).
 *
 * `lobe-agent-management`'s dispatch API (`callAgent`) does NOT need an entry
 * here: the whole tool — dispatch included — is simply absent from
 * `SHARE_VISITOR_ALLOWED_IDENTIFIERS`, so it never survives that gate.
 */
export const SUB_AGENT_DISPATCH_APIS: Record<
  string,
  { apiNames: ReadonlySet<string>; systemRoleWithoutDispatch: string }
> = {
  [LobeAgentIdentifier]: {
    apiNames: LOBE_AGENT_SUB_AGENT_APIS,
    systemRoleWithoutDispatch: systemPromptWithoutSubAgent,
  },
};

export const stripSubAgentDispatchApis = (toolSet: ShareGateToolSet): void => {
  for (const [identifier, { apiNames, systemRoleWithoutDispatch }] of Object.entries(
    SUB_AGENT_DISPATCH_APIS,
  )) {
    const manifest = toolSet.manifestMap[identifier];
    if (manifest) {
      // Always pin the sanitized `systemRole`, not only when `api` still
      // carries the dispatch entry — an already context-aware-trimmed manifest
      // (api filtered upstream) could otherwise keep a stale `systemRole` that
      // still instructs the model to call the removed tool.
      toolSet.manifestMap[identifier] = {
        ...manifest,
        api: manifest.api.filter((api) => !apiNames.has(api.name)),
        systemRole: systemRoleWithoutDispatch,
      };
    }

    if (toolSet.tools) {
      const dispatchToolNames = new Set(
        [...apiNames].map((apiName) => `${identifier}${PLUGIN_SCHEMA_SEPARATOR}${apiName}`),
      );
      pruneArrayInPlace(toolSet.tools, (tool) => !dispatchToolNames.has(tool?.function?.name));
    }
  }
};

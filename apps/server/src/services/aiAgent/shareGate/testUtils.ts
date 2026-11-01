import { ToolNameResolver } from '@lobechat/context-engine';

import type { AgentShareGate, ShareGateToolSet } from '.';

export const buildGate = (config: Partial<AgentShareGate['shareConfig']> = {}): AgentShareGate => ({
  agentId: 'agent-1',
  shareConfig: {
    maxTopicsPerVisitor: 5,
    maxTurnsPerTopic: 20,
    ...config,
  },
  shareId: 'share-1',
  visitorUserId: 'visitor-1',
});

/**
 * Go through the REAL `ToolNameResolver` — the same class the share gate and
 * `ToolsEngine` use — instead of hand-concatenating `identifier____apiName`.
 * A hand-built string only matches what the resolver actually produces when
 * neither segment needs normalizing; it silently diverges for a `type` other
 * than `builtin`/`default` (an extra `____<type>` segment) or for an
 * api/identifier name the resolver MD5-hashes (invalid characters, or long
 * enough to hit the provider name-length cap). Using the real resolver here
 * is what makes the MCP-manifest and long-name tests below fail against a
 * naive slice-based strip instead of staying false-green.
 */
const toolNameResolver = new ToolNameResolver();
export const toolName = (identifier: string, apiName: string, type: string = 'builtin') =>
  toolNameResolver.generate(identifier, apiName, type);

/**
 * Build a tool set whose parallel structures (manifests, maps, id arrays and
 * the function-calling `tools` schema) are all consistent, so an assertion can
 * check that a strip touched EVERY structure rather than just the manifest.
 */
export const buildToolSet = (
  entries: Array<{
    apis: Array<{ humanIntervention?: unknown; name: string }>;
    identifier: string;
    type?: string;
  }>,
): ShareGateToolSet => {
  const toolSet: ShareGateToolSet = {
    activatableToolIds: entries.map((entry) => entry.identifier),
    enabledToolIds: entries.map((entry) => entry.identifier),
    executorMap: {},
    manifestMap: {},
    sourceMap: {},
    tools: [],
  };

  for (const { apis, identifier, type = 'builtin' } of entries) {
    toolSet.manifestMap[identifier] = {
      api: apis.map((api) => ({
        description: api.name,
        humanIntervention: api.humanIntervention,
        name: api.name,
        parameters: { properties: {}, type: 'object' },
      })),
      identifier,
      type,
    } as any;
    toolSet.sourceMap[identifier] = 'builtin' as any;
    toolSet.executorMap[identifier] = {} as any;
    for (const api of apis) {
      toolSet.tools!.push({
        function: { name: toolName(identifier, api.name, type) },
        type: 'function',
      });
    }
  }

  return toolSet;
};

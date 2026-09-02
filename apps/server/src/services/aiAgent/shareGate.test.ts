import {
  AgentDocumentsApiName,
  AgentDocumentsIdentifier,
} from '@lobechat/builtin-tool-agent-documents';
import { AgentManagementIdentifier } from '@lobechat/builtin-tool-agent-management';
import { CalculatorIdentifier } from '@lobechat/builtin-tool-calculator';
import {
  KnowledgeBaseApiName,
  KnowledgeBaseIdentifier,
} from '@lobechat/builtin-tool-knowledge-base';
import {
  LobeAgentApiName,
  LobeAgentIdentifier,
  systemPromptWithoutSubAgent,
} from '@lobechat/builtin-tool-lobe-agent';
import { MemoryApiName, MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import {
  AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS,
  AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS,
  builtinTools,
} from '@lobechat/builtin-tools';
import { describe, expect, it } from 'vitest';

import type { AgentShareGate, ShareGateToolSet } from './shareGate';
import {
  applyShareGateToAgentConfig,
  applyShareGateToToolSet,
  filterPluginsByShareGate,
  isShareBlockedBuiltinDispatch,
  isShareBlockedDataToolCall,
} from './shareGate';

const buildGate = (config: Partial<AgentShareGate['shareConfig']> = {}): AgentShareGate => ({
  agentId: 'agent-1',
  shareConfig: {
    maxTopicsPerVisitor: 5,
    maxTurnsPerTopic: 20,
    ...config,
  },
  shareId: 'share-1',
  visitorUserId: 'visitor-1',
});

const SEPARATOR = '____';

const toolName = (identifier: string, apiName: string) => `${identifier}${SEPARATOR}${apiName}`;

/**
 * Build a tool set whose parallel structures (manifests, maps, id arrays and
 * the function-calling `tools` schema) are all consistent, so an assertion can
 * check that a strip touched EVERY structure rather than just the manifest.
 */
const buildToolSet = (
  entries: Array<{
    apis: Array<{ humanIntervention?: unknown; name: string }>;
    identifier: string;
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

  for (const { apis, identifier } of entries) {
    toolSet.manifestMap[identifier] = {
      api: apis.map((api) => ({
        description: api.name,
        humanIntervention: api.humanIntervention,
        name: api.name,
        parameters: { properties: {}, type: 'object' },
      })),
      identifier,
      type: 'builtin',
    } as any;
    toolSet.sourceMap[identifier] = 'builtin' as any;
    toolSet.executorMap[identifier] = {} as any;
    for (const api of apis) {
      toolSet.tools!.push({ function: { name: toolName(identifier, api.name) }, type: 'function' });
    }
  }

  return toolSet;
};

describe('filterPluginsByShareGate', () => {
  it('keeps only allowlisted plugin ids', () => {
    const gate = buildGate({ enabledToolIds: ['web-search', 'mcp-github'] });

    expect(filterPluginsByShareGate(['web-search', 'local-system', 'mcp-github'], gate)).toEqual([
      'web-search',
      'mcp-github',
    ]);
  });

  it('exposes no tools when the allowlist is missing or empty', () => {
    expect(filterPluginsByShareGate(['web-search'], buildGate())).toEqual([]);
    expect(filterPluginsByShareGate(['web-search'], buildGate({ enabledToolIds: [] }))).toEqual([]);
  });
});

describe('applyShareGateToAgentConfig', () => {
  it('always strips files and knowledge bases', () => {
    const agentConfig = {
      files: [{ enabled: true, id: 'f1' }],
      knowledgeBases: [{ enabled: true, id: 'kb1' }],
    };

    applyShareGateToAgentConfig(agentConfig);

    expect(agentConfig.files).toEqual([]);
    expect(agentConfig.knowledgeBases).toEqual([]);
  });
});

describe('AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS', () => {
  it('only names identifiers that exist in the real builtin registry', () => {
    const registered = new Set(builtinTools.map((tool) => tool.identifier));

    for (const identifier of AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS) {
      expect(registered.has(identifier), `${identifier} is not a registered builtin`).toBe(true);
    }
  });

  it('does not allowlist the confirmed creator-data leak tools', () => {
    for (const identifier of [
      AgentManagementIdentifier,
      'lobe-local-system',
      'lobe-cloud-sandbox',
      'lobe-creds',
      'lobe-task',
    ]) {
      expect(AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS.has(identifier)).toBe(false);
    }
  });
});

/**
 * The owner-facing share settings tool picker renders this set as permanently
 * unavailable. If a grant here is ever relaxed server-side without updating
 * the exported set, the UI would start offering a toggle the gate still
 * ignores — so pin the two together.
 */
describe('AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS', () => {
  const maximalPermissions = { allowReadMemory: true, knowledgeBaseIds: ['kb1'] };

  it('names only allowlisted identifiers', () => {
    for (const identifier of AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS) {
      expect(AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS.has(identifier)).toBe(true);
    }
  });

  it('matches exactly the allowlisted identifiers blocked under maximal permissions', () => {
    // `readOnlyApiName` stands in for any API: an unconditional `none` grant
    // blocks the identifier before the per-API rules are ever consulted.
    const blockedUnderMaximalPermissions = [...AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS].filter(
      (identifier) => isShareBlockedDataToolCall(maximalPermissions, identifier, 'readOnlyApiName'),
    );

    expect(new Set(blockedUnderMaximalPermissions)).toEqual(
      AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS,
    );
  });

  it('excludes memory, whose grant is conditional on allowReadMemory', () => {
    expect(AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS.has(MemoryIdentifier)).toBe(false);
  });
});

describe('isShareBlockedDataToolCall', () => {
  it('lets non-builtin identifiers through untouched', () => {
    expect(isShareBlockedDataToolCall({}, 'mcp-github', 'anything')).toBe(false);
  });

  it('default-denies any builtin outside the allowlist', () => {
    expect(isShareBlockedDataToolCall({}, AgentManagementIdentifier, 'searchAgent')).toBe(true);
  });

  it('allows an allowlisted builtin with no data rule', () => {
    expect(isShareBlockedDataToolCall({}, CalculatorIdentifier, 'calculate')).toBe(false);
  });

  describe('memory', () => {
    it('blocks every api without allowReadMemory', () => {
      expect(isShareBlockedDataToolCall({}, MemoryIdentifier, MemoryApiName.searchUserMemory)).toBe(
        true,
      );
    });

    it('allows reads but never writes with allowReadMemory', () => {
      const permissions = { allowReadMemory: true };

      expect(
        isShareBlockedDataToolCall(permissions, MemoryIdentifier, MemoryApiName.searchUserMemory),
      ).toBe(false);
      expect(
        isShareBlockedDataToolCall(permissions, MemoryIdentifier, MemoryApiName.addContextMemory),
      ).toBe(true);
    });
  });

  it('blocks agent documents and knowledge base outright (no grant exists)', () => {
    expect(
      isShareBlockedDataToolCall(
        { allowReadMemory: true },
        AgentDocumentsIdentifier,
        AgentDocumentsApiName.listDocuments,
      ),
    ).toBe(true);
    expect(
      isShareBlockedDataToolCall(
        { allowReadMemory: true, knowledgeBaseIds: ['kb1'] },
        KnowledgeBaseIdentifier,
        KnowledgeBaseApiName.viewKnowledgeBase,
        { id: 'kb1' },
      ),
    ).toBe(true);
  });
});

describe('applyShareGateToToolSet', () => {
  it('drops everything the owner picker did not enable', () => {
    const toolSet = buildToolSet([
      { apis: [{ name: 'calculate' }], identifier: CalculatorIdentifier },
      { apis: [{ name: 'searchAgent' }], identifier: AgentManagementIdentifier },
    ]);

    applyShareGateToToolSet(toolSet, buildGate({ enabledToolIds: [CalculatorIdentifier] }));

    expect(toolSet.enabledToolIds).toEqual([CalculatorIdentifier]);
    expect(toolSet.activatableToolIds).toEqual([CalculatorIdentifier]);
    expect(Object.keys(toolSet.manifestMap)).toEqual([CalculatorIdentifier]);
    expect(Object.keys(toolSet.sourceMap)).toEqual([CalculatorIdentifier]);
    expect(Object.keys(toolSet.executorMap)).toEqual([CalculatorIdentifier]);
    expect(toolSet.tools).toHaveLength(1);
  });

  it('drops a builtin the owner enabled but the master allowlist denies', () => {
    const toolSet = buildToolSet([
      { apis: [{ name: 'searchAgent' }], identifier: AgentManagementIdentifier },
    ]);

    applyShareGateToToolSet(toolSet, buildGate({ enabledToolIds: [AgentManagementIdentifier] }));

    expect(toolSet.enabledToolIds).toEqual([]);
    expect(toolSet.manifestMap).toEqual({});
    expect(toolSet.tools).toEqual([]);
  });

  it('keeps a non-builtin plugin the owner enabled', () => {
    const toolSet = buildToolSet([{ apis: [{ name: 'run' }], identifier: 'mcp-github' }]);

    applyShareGateToToolSet(toolSet, buildGate({ enabledToolIds: ['mcp-github'] }));

    expect(toolSet.enabledToolIds).toEqual(['mcp-github']);
  });

  it('collapses the whole set when no tools are enabled', () => {
    const toolSet = buildToolSet([
      { apis: [{ name: 'calculate' }], identifier: CalculatorIdentifier },
    ]);

    applyShareGateToToolSet(toolSet, buildGate());

    expect(toolSet.enabledToolIds).toEqual([]);
    expect(toolSet.tools).toEqual([]);
  });

  it('strips callSubAgent and pins the dispatch-free systemRole', () => {
    const toolSet = buildToolSet([
      {
        apis: [{ name: LobeAgentApiName.callSubAgent }, { name: LobeAgentApiName.analyzeMedia }],
        identifier: LobeAgentIdentifier,
      },
    ]);

    applyShareGateToToolSet(toolSet, buildGate({ enabledToolIds: [LobeAgentIdentifier] }));

    const manifest = toolSet.manifestMap[LobeAgentIdentifier];
    expect(manifest.api.map((api) => api.name)).not.toContain(LobeAgentApiName.callSubAgent);
    expect(manifest.systemRole).toBe(systemPromptWithoutSubAgent);
    expect(toolSet.tools!.map((tool: any) => tool.function.name)).not.toContain(
      toolName(LobeAgentIdentifier, LobeAgentApiName.callSubAgent),
    );
  });

  it('drops a memory tool without allowReadMemory and strips its writes with it', () => {
    const build = () =>
      buildToolSet([
        {
          apis: [
            { name: MemoryApiName.searchUserMemory },
            { name: MemoryApiName.addContextMemory },
          ],
          identifier: MemoryIdentifier,
        },
      ]);

    const denied = build();
    applyShareGateToToolSet(denied, buildGate({ enabledToolIds: [MemoryIdentifier] }));
    expect(denied.manifestMap[MemoryIdentifier]).toBeUndefined();
    expect(denied.enabledToolIds).toEqual([]);

    const granted = build();
    applyShareGateToToolSet(
      granted,
      buildGate({ allowReadMemory: true, enabledToolIds: [MemoryIdentifier] }),
    );
    expect(granted.manifestMap[MemoryIdentifier].api.map((api) => api.name)).toEqual([
      MemoryApiName.searchUserMemory,
    ]);
    expect(granted.tools!.map((tool: any) => tool.function.name)).toEqual([
      toolName(MemoryIdentifier, MemoryApiName.searchUserMemory),
    ]);
  });

  it('strips apis whose humanIntervention can never resolve under reject mode', () => {
    const toolSet = buildToolSet([
      {
        apis: [
          { name: 'safe' },
          { humanIntervention: 'never', name: 'explicitlySafe' },
          { humanIntervention: 'required', name: 'needsApproval' },
          { humanIntervention: 'always', name: 'alwaysAsks' },
          { humanIntervention: { type: 'dynamic' }, name: 'maybeAsks' },
        ],
        identifier: CalculatorIdentifier,
      },
    ]);

    applyShareGateToToolSet(toolSet, buildGate({ enabledToolIds: [CalculatorIdentifier] }));

    expect(toolSet.manifestMap[CalculatorIdentifier].api.map((api) => api.name)).toEqual([
      'safe',
      'explicitlySafe',
    ]);
    expect(toolSet.tools).toHaveLength(2);
  });

  it('drops a tool whose tool-level humanIntervention is unusable', () => {
    const toolSet = buildToolSet([
      { apis: [{ name: 'calculate' }], identifier: CalculatorIdentifier },
    ]);
    (toolSet.manifestMap[CalculatorIdentifier] as any).humanIntervention = 'required';

    applyShareGateToToolSet(toolSet, buildGate({ enabledToolIds: [CalculatorIdentifier] }));

    expect(toolSet.manifestMap[CalculatorIdentifier]).toBeUndefined();
    expect(toolSet.enabledToolIds).toEqual([]);
  });

  it('strips a required-intervention API from a non-builtin (MCP/connector) manifest, keeping its normal APIs', () => {
    // Mirrors `buildConnectorManifests.ts`: a connector tool with the
    // `needs_approval` permission maps to `humanIntervention: 'required'` on
    // an otherwise-ordinary MCP manifest. Regression for the fix that widened
    // `applyShareGateToInterventionRequiredApis` beyond builtin-only
    // manifests — the connector permission gate at dispatch time
    // (`ToolExecutionService.executeTool`) only hard-blocks `disabled`, so
    // this assembly-time strip is the only thing stopping a share visitor's
    // headless run from auto-executing a "needs approval" connector call.
    const toolSet = buildToolSet([
      {
        apis: [{ name: 'listRepos' }, { humanIntervention: 'required', name: 'deleteRepo' }],
        identifier: 'mcp-github',
      },
    ]);

    applyShareGateToToolSet(toolSet, buildGate({ enabledToolIds: ['mcp-github'] }));

    expect(toolSet.manifestMap['mcp-github'].api.map((api) => api.name)).toEqual(['listRepos']);
    expect(toolSet.tools!.map((tool: any) => tool.function.name)).toEqual([
      toolName('mcp-github', 'listRepos'),
    ]);
  });
});

// Dispatch-time full gate, asserted against the REAL manifests: a call that
// bypassed assembly must clear the master allowlist, the owner's
// enabledToolIds picker, the UNSTRIPPED manifest's humanIntervention policy,
// and the data-tool rules — in that order, all fail-closed.
describe('isShareBlockedBuiltinDispatch', () => {
  it('blocks an allowlisted builtin the owner did not enable', () => {
    expect(isShareBlockedBuiltinDispatch({}, CalculatorIdentifier, 'evalExpression')).toBe(true);
  });

  it('passes an enabled builtin with no intervention semantics', () => {
    expect(
      isShareBlockedBuiltinDispatch(
        { enabledToolIds: [LobeAgentIdentifier] },
        LobeAgentIdentifier,
        LobeAgentApiName.analyzeMedia,
      ),
    ).toBe(false);
  });

  it("blocks 'required'- and 'always'-intervention APIs even on an enabled tool", () => {
    // createPlan is humanIntervention: 'required' in the real manifest — the
    // assembly strip removes that config from the runtime-visible manifest,
    // so under headless it would auto-run without its consent step. The
    // dispatch gate re-reads the unstripped manifest and blocks.
    for (const apiName of [LobeAgentApiName.createPlan, LobeAgentApiName.askUserQuestion]) {
      expect(
        isShareBlockedBuiltinDispatch(
          { enabledToolIds: [LobeAgentIdentifier] },
          LobeAgentIdentifier,
          apiName,
        ),
      ).toBe(true);
    }
  });

  it('blocks sub-agent dispatch even on an enabled tool with no intervention config', () => {
    // callSubAgent carries no humanIntervention, so neither the intervention
    // check nor the data-tool rules would catch it — and the child run it
    // spawns does not inherit the parent's shareGate. Must be blocked by its
    // dedicated dispatch rule.
    expect(
      isShareBlockedBuiltinDispatch(
        { enabledToolIds: [LobeAgentIdentifier] },
        LobeAgentIdentifier,
        LobeAgentApiName.callSubAgent,
      ),
    ).toBe(true);
  });

  it('still applies the data-tool rules after the enable check', () => {
    const enabled = { enabledToolIds: [MemoryIdentifier] };

    expect(
      isShareBlockedBuiltinDispatch(enabled, MemoryIdentifier, MemoryApiName.searchUserMemory),
    ).toBe(true);
    expect(
      isShareBlockedBuiltinDispatch(
        { ...enabled, allowReadMemory: true },
        MemoryIdentifier,
        MemoryApiName.searchUserMemory,
      ),
    ).toBe(false);
    expect(
      isShareBlockedBuiltinDispatch(
        { ...enabled, allowReadMemory: true },
        MemoryIdentifier,
        MemoryApiName.addContextMemory,
      ),
    ).toBe(true);
  });

  it('ignores non-builtin identifiers entirely', () => {
    expect(isShareBlockedBuiltinDispatch({}, 'some-mcp-server', 'anything')).toBe(false);
  });

  it('blocks a builtin outside the master allowlist regardless of enablement', () => {
    expect(
      isShareBlockedBuiltinDispatch(
        { enabledToolIds: [AgentManagementIdentifier] },
        AgentManagementIdentifier,
        'searchAgent',
      ),
    ).toBe(true);
  });
});

import {
  AgentDocumentsApiName,
  AgentDocumentsIdentifier,
} from '@lobechat/builtin-tool-agent-documents';
import { AgentManagementIdentifier } from '@lobechat/builtin-tool-agent-management';
import { CalculatorIdentifier } from '@lobechat/builtin-tool-calculator';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
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
import { TopicReferenceIdentifier } from '@lobechat/builtin-tool-topic-reference';
import {
  AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS,
  AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS,
  builtinTools,
} from '@lobechat/builtin-tools';
import { ToolNameResolver } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import type { AgentShareGate, ShareGateToolSet } from './shareGate';
import {
  applyShareGateToAgentConfig,
  applyShareGateToToolSet,
  filterPluginsByShareGate,
  isShareBlockedBuiltinDispatch,
  isShareBlockedDataToolCall,
  shareGateGrantsCloudSandbox,
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

/**
 * Go through the REAL `ToolNameResolver` — the same class `shareGate.ts` and
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
const toolName = (identifier: string, apiName: string, type: string = 'builtin') =>
  toolNameResolver.generate(identifier, apiName, type);

/**
 * Build a tool set whose parallel structures (manifests, maps, id arrays and
 * the function-calling `tools` schema) are all consistent, so an assertion can
 * check that a strip touched EVERY structure rather than just the manifest.
 */
const buildToolSet = (
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

describe('filterPluginsByShareGate', () => {
  it('keeps only allowlisted plugin ids', () => {
    const gate = buildGate({
      toolGrants: [{ identifier: 'web-search' }, { identifier: 'mcp-github' }],
    });

    expect(filterPluginsByShareGate(['web-search', 'local-system', 'mcp-github'], gate)).toEqual([
      'web-search',
      'mcp-github',
    ]);
  });

  it('exposes no tools when the allowlist is missing or empty', () => {
    expect(filterPluginsByShareGate(['web-search'], buildGate())).toEqual([]);
    expect(filterPluginsByShareGate(['web-search'], buildGate({ toolGrants: [] }))).toEqual([]);
  });

  it('treats a per-API grant as candidacy for the whole identifier', () => {
    // Narrowing down to the specific granted API happens later, in
    // `applyShareGateToToolSet`, once the real manifest is known — this pass
    // only decides whether the identifier is a candidate at all.
    const gate = buildGate({
      toolGrants: [{ apis: [LobeAgentApiName.analyzeMedia], identifier: LobeAgentIdentifier }],
    });

    expect(filterPluginsByShareGate([LobeAgentIdentifier, 'mcp-github'], gate)).toEqual([
      LobeAgentIdentifier,
    ]);
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
      'lobe-creds',
      'lobe-task',
      TopicReferenceIdentifier,
    ]) {
      expect(AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS.has(identifier)).toBe(false);
    }
  });

  // `lobe-cloud-sandbox` is allowlisted despite its general-purpose reach: a
  // share visitor's run gets an isolated per-topic sandbox session with no
  // `lh` CLI JWT shim, so it cannot mint or exfiltrate the creator's
  // credentials — see the positive-evidence doc block above
  // `applyShareGateToInterventionRequiredApis` in `shareGate.ts`.
  it('allowlists lobe-cloud-sandbox now that visitor runs get a credential-free sandbox session', () => {
    expect(AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS.has('lobe-cloud-sandbox')).toBe(true);
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

    applyShareGateToToolSet(
      toolSet,
      buildGate({ toolGrants: [{ identifier: CalculatorIdentifier }] }),
    );

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

    applyShareGateToToolSet(
      toolSet,
      buildGate({ toolGrants: [{ identifier: AgentManagementIdentifier }] }),
    );

    expect(toolSet.enabledToolIds).toEqual([]);
    expect(toolSet.manifestMap).toEqual({});
    expect(toolSet.tools).toEqual([]);
  });

  it('drops a stale lobe-topic-reference grant left over from before it was denied', () => {
    // `TopicReferenceExecutionRuntime.getTopicContext` resolves a free-form
    // topicId via `TopicModel.findOwnTopicById`, scoped only to the creator's
    // whole store — not to this share/agent. A share config saved while it was
    // still allowlisted could still carry it in `toolGrants`; the gate must
    // keep dropping it rather than newly trusting the stored config.
    const toolSet = buildToolSet([
      { apis: [{ name: 'getTopicContext' }], identifier: TopicReferenceIdentifier },
    ]);

    applyShareGateToToolSet(
      toolSet,
      buildGate({ toolGrants: [{ identifier: TopicReferenceIdentifier }] }),
    );

    expect(toolSet.enabledToolIds).toEqual([]);
    expect(toolSet.manifestMap).toEqual({});
    expect(toolSet.tools).toEqual([]);
  });

  it('keeps a non-builtin plugin the owner enabled', () => {
    const toolSet = buildToolSet([{ apis: [{ name: 'run' }], identifier: 'mcp-github' }]);

    applyShareGateToToolSet(toolSet, buildGate({ toolGrants: [{ identifier: 'mcp-github' }] }));

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

  it('narrows a per-API grant down to just the named API', () => {
    const toolSet = buildToolSet([
      {
        apis: [{ name: LobeAgentApiName.analyzeMedia }, { name: LobeAgentApiName.updatePlan }],
        identifier: LobeAgentIdentifier,
      },
    ]);

    applyShareGateToToolSet(
      toolSet,
      buildGate({
        toolGrants: [{ apis: [LobeAgentApiName.analyzeMedia], identifier: LobeAgentIdentifier }],
      }),
    );

    // The identifier itself stays enabled (it has a surviving API)...
    expect(toolSet.enabledToolIds).toEqual([LobeAgentIdentifier]);
    // ...but only the granted API remains on the manifest and the
    // function-calling schema.
    expect(toolSet.manifestMap[LobeAgentIdentifier].api.map((api) => api.name)).toEqual([
      LobeAgentApiName.analyzeMedia,
    ]);
    expect(toolSet.tools!.map((tool: any) => tool.function.name)).toEqual([
      toolName(LobeAgentIdentifier, LobeAgentApiName.analyzeMedia),
    ]);
  });

  it('drops the whole tool when a per-API grant names no surviving API', () => {
    const toolSet = buildToolSet([
      { apis: [{ name: LobeAgentApiName.analyzeMedia }], identifier: LobeAgentIdentifier },
    ]);

    // Granted API name does not exist on this manifest at all (e.g. stale
    // config from a renamed API) — zero APIs survive, so the identifier is
    // dropped entirely rather than left offering nothing.
    applyShareGateToToolSet(
      toolSet,
      buildGate({ toolGrants: [{ apis: ['noSuchApi'], identifier: LobeAgentIdentifier }] }),
    );

    expect(toolSet.enabledToolIds).toEqual([]);
    expect(toolSet.manifestMap).toEqual({});
    expect(toolSet.tools).toEqual([]);
  });

  it('lets a toolset-level entry grant every surviving API, overriding a redundant per-API entry', () => {
    const toolSet = buildToolSet([
      {
        apis: [{ name: LobeAgentApiName.analyzeMedia }, { name: LobeAgentApiName.updatePlan }],
        identifier: LobeAgentIdentifier,
      },
    ]);

    applyShareGateToToolSet(
      toolSet,
      buildGate({
        toolGrants: [
          { identifier: LobeAgentIdentifier },
          { apis: [LobeAgentApiName.analyzeMedia], identifier: LobeAgentIdentifier },
        ],
      }),
    );

    expect(toolSet.manifestMap[LobeAgentIdentifier].api.map((api) => api.name).sort()).toEqual(
      [LobeAgentApiName.analyzeMedia, LobeAgentApiName.updatePlan].sort(),
    );
  });

  it('strips callSubAgent and pins the dispatch-free systemRole', () => {
    const toolSet = buildToolSet([
      {
        apis: [{ name: LobeAgentApiName.callSubAgent }, { name: LobeAgentApiName.analyzeMedia }],
        identifier: LobeAgentIdentifier,
      },
    ]);

    applyShareGateToToolSet(
      toolSet,
      buildGate({ toolGrants: [{ identifier: LobeAgentIdentifier }] }),
    );

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
    applyShareGateToToolSet(denied, buildGate({ toolGrants: [{ identifier: MemoryIdentifier }] }));
    expect(denied.manifestMap[MemoryIdentifier]).toBeUndefined();
    expect(denied.enabledToolIds).toEqual([]);

    const granted = build();
    applyShareGateToToolSet(
      granted,
      buildGate({ allowReadMemory: true, toolGrants: [{ identifier: MemoryIdentifier }] }),
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

    applyShareGateToToolSet(
      toolSet,
      buildGate({ toolGrants: [{ identifier: CalculatorIdentifier }] }),
    );

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

    applyShareGateToToolSet(
      toolSet,
      buildGate({ toolGrants: [{ identifier: CalculatorIdentifier }] }),
    );

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
        type: 'mcp',
      },
    ]);

    applyShareGateToToolSet(toolSet, buildGate({ toolGrants: [{ identifier: 'mcp-github' }] }));

    expect(toolSet.manifestMap['mcp-github'].api.map((api) => api.name)).toEqual(['listRepos']);
    // `type: 'mcp'` means `ToolNameResolver.generate` appends a THIRD
    // `____mcp` segment to the function-calling name — a naive
    // `identifier____apiName` string would never match this, so this
    // assertion only passes when the strip regenerates the real name.
    expect(toolSet.tools!.map((tool: any) => tool.function.name)).toEqual([
      toolName('mcp-github', 'listRepos', 'mcp'),
    ]);
    expect(toolSet.tools!.map((tool: any) => tool.function.name)).not.toContain(
      `mcp-github____deleteRepo____mcp`,
    );
  });

  it('narrows a per-API grant on a non-builtin (MCP) manifest, matching the real `____<type>`-suffixed generated name', () => {
    const toolSet = buildToolSet([
      {
        apis: [{ name: 'listRepos' }, { name: 'deleteRepo' }],
        identifier: 'mcp-github',
        type: 'mcp',
      },
    ]);

    // The grant in `shareConfig.toolGrants` names the RAW api name, independent
    // of whatever `ToolNameResolver.generate` does for the WIRE tool-call name
    // — the third `____mcp` segment only ever appears on the generated
    // dispatch name asserted below, never on the grant itself.
    applyShareGateToToolSet(
      toolSet,
      buildGate({ toolGrants: [{ apis: ['listRepos'], identifier: 'mcp-github' }] }),
    );

    expect(toolSet.manifestMap['mcp-github'].api.map((api) => api.name)).toEqual(['listRepos']);
    expect(toolSet.tools!.map((tool: any) => tool.function.name)).toEqual([
      toolName('mcp-github', 'listRepos', 'mcp'),
    ]);
  });

  it('narrows a per-API grant on an MCP manifest whose blocked API name is long/non-ASCII enough to be MD5-hashed', () => {
    // `ToolNameResolver.generate` hashes the API segment once the raw name
    // would push the generated tool-call name past the provider length cap,
    // and hashes on invalid characters regardless of length — both common
    // for server-controlled MCP API names, unlike a builtin's small fixed
    // API surface. A strip that slices `identifier.length + SEPARATOR.length`
    // off the generated name (instead of regenerating it) would recover
    // garbage here and fail to match either API, leaving the blocked one
    // reachable.
    const longApiName = 'a'.repeat(80);
    const nonAsciiApiName = '删除仓库';
    const toolSet = buildToolSet([
      {
        apis: [{ name: longApiName }, { name: nonAsciiApiName }],
        identifier: 'mcp-github',
        type: 'mcp',
      },
    ]);

    applyShareGateToToolSet(
      toolSet,
      buildGate({ toolGrants: [{ apis: [longApiName], identifier: 'mcp-github' }] }),
    );

    expect(toolSet.manifestMap['mcp-github'].api.map((api) => api.name)).toEqual([longApiName]);
    expect(toolSet.tools!.map((tool: any) => tool.function.name)).toEqual([
      toolName('mcp-github', longApiName, 'mcp'),
    ]);
    expect(toolSet.tools!.map((tool: any) => tool.function.name)).not.toContain(
      toolName('mcp-github', nonAsciiApiName, 'mcp'),
    );
  });

  // `ToolNameResolver.generate` hashes the IDENTIFIER segment too — on
  // invalid characters unconditionally, and on length once the api segment
  // alone is not enough to fit under the cap. A prune that decides "belongs
  // to this identifier" by comparing the generated name's first segment
  // against the raw identifier never matches such a tool and silently keeps
  // every entry — failing OPEN for exactly the MCP connectors whose
  // identifiers are server-supplied and unconstrained.
  it('narrows a per-API grant on an MCP manifest whose IDENTIFIER is non-ASCII and therefore MD5-hashed', () => {
    const identifier = '中文连接器';
    const toolSet = buildToolSet([
      { apis: [{ name: 'listRepos' }, { name: 'deleteRepo' }], identifier, type: 'mcp' },
    ]);

    // Sanity: the generated name must NOT start with the literal identifier,
    // otherwise this test would not exercise the hashed path.
    expect(toolName(identifier, 'listRepos', 'mcp').startsWith(identifier)).toBe(false);

    applyShareGateToToolSet(
      toolSet,
      buildGate({ toolGrants: [{ apis: ['listRepos'], identifier }] }),
    );

    expect(toolSet.manifestMap[identifier].api.map((api) => api.name)).toEqual(['listRepos']);
    expect(toolSet.tools!.map((tool: any) => tool.function.name)).toEqual([
      toolName(identifier, 'listRepos', 'mcp'),
    ]);
  });

  it('narrows a per-API grant on an MCP manifest whose IDENTIFIER is long enough to be MD5-hashed', () => {
    const identifier = 'x'.repeat(70);
    const apiName = 'y'.repeat(20);
    const toolSet = buildToolSet([
      { apis: [{ name: apiName }, { name: 'deleteRepo' }], identifier, type: 'mcp' },
    ]);

    expect(toolName(identifier, apiName, 'mcp').startsWith(identifier)).toBe(false);

    applyShareGateToToolSet(toolSet, buildGate({ toolGrants: [{ apis: [apiName], identifier }] }));

    expect(toolSet.manifestMap[identifier].api.map((api) => api.name)).toEqual([apiName]);
    expect(toolSet.tools!.map((tool: any) => tool.function.name)).toEqual([
      toolName(identifier, apiName, 'mcp'),
    ]);
  });

  it('drops an MCP tool entirely (dropToolFromSet) even when its IDENTIFIER segment is MD5-hashed', () => {
    const identifier = '中文连接器';
    const toolSet = buildToolSet([
      { apis: [{ name: 'listRepos' }], identifier, type: 'mcp' },
      { apis: [{ name: 'listRepos' }], identifier: 'mcp-gitlab', type: 'mcp' },
    ]);

    applyShareGateToToolSet(toolSet, buildGate({ toolGrants: [{ identifier: 'mcp-gitlab' }] }));

    expect(toolSet.manifestMap[identifier]).toBeUndefined();
    expect(toolSet.tools!.map((tool: any) => tool.function.name)).toEqual([
      toolName('mcp-gitlab', 'listRepos', 'mcp'),
    ]);
  });

  it('drops an MCP tool identifier entirely (dropToolFromSet) without leaving stray generated-name entries behind', () => {
    const toolSet = buildToolSet([
      { apis: [{ name: 'listRepos' }], identifier: 'mcp-github', type: 'mcp' },
      { apis: [{ name: 'listRepos' }], identifier: 'mcp-gitlab', type: 'mcp' },
    ]);

    // `mcp-github` gets no grant at all; `mcp-gitlab` does, and must survive
    // untouched — proves `dropToolFromSet`'s identifier-prefix match isn't
    // accidentally over- or under-matching once a third `____mcp` segment is
    // in play.
    applyShareGateToToolSet(toolSet, buildGate({ toolGrants: [{ identifier: 'mcp-gitlab' }] }));

    expect(toolSet.manifestMap['mcp-github']).toBeUndefined();
    expect(toolSet.manifestMap['mcp-gitlab']).toBeDefined();
    expect(toolSet.tools!.map((tool: any) => tool.function.name)).toEqual([
      toolName('mcp-gitlab', 'listRepos', 'mcp'),
    ]);
  });
});

// Dispatch-time full gate, asserted against the REAL manifests: a call that
// bypassed assembly must clear the master allowlist, the owner's
// toolGrants picker, the UNSTRIPPED manifest's humanIntervention policy,
// and the data-tool rules — in that order, all fail-closed.
describe('isShareBlockedBuiltinDispatch', () => {
  it('blocks an allowlisted builtin the owner did not enable', () => {
    expect(isShareBlockedBuiltinDispatch({}, CalculatorIdentifier, 'evalExpression')).toBe(true);
  });

  it('passes an enabled builtin with no intervention semantics', () => {
    expect(
      isShareBlockedBuiltinDispatch(
        { toolGrants: [{ identifier: LobeAgentIdentifier }] },
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
          { toolGrants: [{ identifier: LobeAgentIdentifier }] },
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
        { toolGrants: [{ identifier: LobeAgentIdentifier }] },
        LobeAgentIdentifier,
        LobeAgentApiName.callSubAgent,
      ),
    ).toBe(true);
  });

  it('still applies the data-tool rules after the enable check', () => {
    const enabled = { toolGrants: [{ identifier: MemoryIdentifier }] };

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
        { toolGrants: [{ identifier: AgentManagementIdentifier }] },
        AgentManagementIdentifier,
        'searchAgent',
      ),
    ).toBe(true);
  });

  it('a per-API grant grants only the named API, not the whole identifier', () => {
    const enabled = {
      toolGrants: [{ apis: [LobeAgentApiName.analyzeMedia], identifier: LobeAgentIdentifier }],
    };

    expect(
      isShareBlockedBuiltinDispatch(enabled, LobeAgentIdentifier, LobeAgentApiName.analyzeMedia),
    ).toBe(false);
    // updatePlan carries no intervention config either, so only the picker's
    // per-API scoping is what blocks it here.
    expect(
      isShareBlockedBuiltinDispatch(enabled, LobeAgentIdentifier, LobeAgentApiName.updatePlan),
    ).toBe(true);
  });
});

describe('shareGateGrantsCloudSandbox', () => {
  it('is false when the share does not grant lobe-cloud-sandbox', () => {
    expect(shareGateGrantsCloudSandbox(buildGate())).toBe(false);
    expect(
      shareGateGrantsCloudSandbox(buildGate({ toolGrants: [{ identifier: 'web-search' }] })),
    ).toBe(false);
  });

  it('is true for a whole-identifier grant', () => {
    expect(
      shareGateGrantsCloudSandbox(
        buildGate({ toolGrants: [{ identifier: CloudSandboxManifest.identifier }] }),
      ),
    ).toBe(true);
  });

  // The plan only needs to know the sandbox is in play at all — narrowing to
  // the granted APIs happens later in `applyShareGateToToolSet`.
  it('treats an apis-scoped grant as a grant of the identifier', () => {
    expect(
      shareGateGrantsCloudSandbox(
        buildGate({
          toolGrants: [{ apis: ['runCommand'], identifier: CloudSandboxManifest.identifier }],
        }),
      ),
    ).toBe(true);
  });
});

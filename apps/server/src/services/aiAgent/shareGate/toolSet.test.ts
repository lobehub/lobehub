import {
  AgentDocumentsApiName,
  AgentDocumentsIdentifier,
  AgentDocumentsManifest,
  agentShareSystemPrompt,
} from '@lobechat/builtin-tool-agent-documents';
import { AgentManagementIdentifier } from '@lobechat/builtin-tool-agent-management';
import { CalculatorIdentifier } from '@lobechat/builtin-tool-calculator';
import {
  LobeAgentApiName,
  LobeAgentIdentifier,
  systemPromptWithoutSubAgent,
} from '@lobechat/builtin-tool-lobe-agent';
import {
  MemoryApiName,
  MemoryIdentifier,
  memoryReadOnlySystemPrompt,
} from '@lobechat/builtin-tool-memory';
import {
  agentShareSystemPrompt as skillsAgentShareSystemPrompt,
  SkillsApiName,
  SkillsIdentifier,
  SkillsManifest,
} from '@lobechat/builtin-tool-skills';
import { TopicReferenceIdentifier } from '@lobechat/builtin-tool-topic-reference';
import { generateToolsFromManifest } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import { applyShareGateToToolSet } from '.';
import { buildGate, buildToolSet, toolName } from './testUtils';

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
    toolSet.manifestMap['mcp-github'].systemRole = 'Use run for repository operations.';

    applyShareGateToToolSet(toolSet, buildGate({ toolGrants: [{ identifier: 'mcp-github' }] }));

    expect(toolSet.enabledToolIds).toEqual(['mcp-github']);
    expect(toolSet.manifestMap['mcp-github'].systemRole).toBe('Use run for repository operations.');
  });

  it('drops a granted MCP server that only the creator machine can reach', () => {
    const toolSet = buildToolSet([
      { apis: [{ name: 'read_file' }], identifier: 'mcp-fs', type: 'mcp' },
      { apis: [{ name: 'query' }], identifier: 'mcp-lan', type: 'mcp' },
      { apis: [{ name: 'run' }], identifier: 'mcp-remote', type: 'mcp' },
    ]);
    (toolSet.manifestMap['mcp-fs'] as any).mcpParams = {
      args: [],
      command: 'npx',
      name: 'mcp-fs',
      type: 'stdio',
    };
    (toolSet.manifestMap['mcp-lan'] as any).mcpParams = {
      name: 'mcp-lan',
      type: 'http',
      url: 'http://192.168.1.20:8000/mcp',
    };
    (toolSet.manifestMap['mcp-remote'] as any).mcpParams = {
      name: 'mcp-remote',
      type: 'http',
      url: 'https://mcp.example.com/mcp',
    };
    toolSet.executorMap['mcp-fs'] = 'client';

    applyShareGateToToolSet(
      toolSet,
      buildGate({
        toolGrants: [
          { identifier: 'mcp-fs' },
          { identifier: 'mcp-lan' },
          { identifier: 'mcp-remote' },
        ],
      }),
    );

    expect(toolSet.enabledToolIds).toEqual(['mcp-remote']);
    expect(toolSet.activatableToolIds).toEqual(['mcp-remote']);
    expect(Object.keys(toolSet.manifestMap)).toEqual(['mcp-remote']);
    expect(toolSet.executorMap).not.toHaveProperty('mcp-fs');
    expect(toolSet.tools!.map((tool) => tool.function.name)).toEqual([
      toolName('mcp-remote', 'run', 'mcp'),
    ]);
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
            { name: MemoryApiName.queryTaxonomyOptions },
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
      MemoryApiName.queryTaxonomyOptions,
      MemoryApiName.searchUserMemory,
    ]);
    expect(granted.manifestMap[MemoryIdentifier].systemRole).toBe(memoryReadOnlySystemPrompt);
    expect(granted.tools!.map((tool: any) => tool.function.name)).toEqual([
      toolName(MemoryIdentifier, MemoryApiName.queryTaxonomyOptions),
      toolName(MemoryIdentifier, MemoryApiName.searchUserMemory),
    ]);
  });

  it('keeps only Share-scoped Agent Documents authoring APIs', () => {
    const toolSet = buildToolSet([
      {
        apis: Object.values(AgentDocumentsApiName).map((name) => ({ name })),
        identifier: AgentDocumentsIdentifier,
      },
    ]);
    toolSet.manifestMap[AgentDocumentsIdentifier] = AgentDocumentsManifest;
    toolSet.tools = generateToolsFromManifest(AgentDocumentsManifest);

    applyShareGateToToolSet(
      toolSet,
      buildGate({ toolGrants: [{ identifier: AgentDocumentsIdentifier }] }),
    );

    const manifest = toolSet.manifestMap[AgentDocumentsIdentifier];
    expect(manifest.api.map((api) => api.name).sort()).toEqual(
      [
        AgentDocumentsApiName.createDocument,
        AgentDocumentsApiName.listDocuments,
        AgentDocumentsApiName.modifyNodes,
        AgentDocumentsApiName.readDocument,
        AgentDocumentsApiName.renameDocument,
        AgentDocumentsApiName.replaceDocumentContent,
      ].sort(),
    );
    expect(manifest.systemRole).toBe(agentShareSystemPrompt);
    expect(manifest.meta?.description).toBe(
      'Create, list, read, edit, and rename documents isolated to the current shared-agent topic.',
    );

    const createDocument = manifest.api.find(
      (api) => api.name === AgentDocumentsApiName.createDocument,
    );
    const listDocuments = manifest.api.find(
      (api) => api.name === AgentDocumentsApiName.listDocuments,
    );
    expect(Object.keys(createDocument!.parameters.properties).sort()).toEqual(['content', 'title']);
    expect(Object.keys(listDocuments!.parameters.properties)).toEqual([]);

    const createDocumentTool = toolSet.tools!.find(
      (tool: any) =>
        tool.function.name ===
        toolName(AgentDocumentsIdentifier, AgentDocumentsApiName.createDocument),
    );
    const listDocumentsTool = toolSet.tools!.find(
      (tool: any) =>
        tool.function.name ===
        toolName(AgentDocumentsIdentifier, AgentDocumentsApiName.listDocuments),
    );
    expect(Object.keys(createDocumentTool!.function.parameters.properties).sort()).toEqual([
      'content',
      'title',
    ]);
    expect(Object.keys(listDocumentsTool!.function.parameters.properties)).toEqual([]);
  });

  // `lobe-skills` is an always-on builtin, so it reaches the tool set without
  // ever appearing in the owner's `toolGrants`. Its opt-in is the SKILL list:
  // the gate derives a synthetic tool grant from `skillGrants`, then narrows it
  // to the two read APIs. Regression for the bug where the tool was simply
  // absent from the allowlist and every skill-driven shared agent broke.
  const buildSkillsToolSet = () => {
    const toolSet = buildToolSet([
      {
        apis: Object.values(SkillsApiName).map((name) => ({ name })),
        identifier: SkillsIdentifier,
      },
    ]);
    toolSet.manifestMap[SkillsIdentifier] = SkillsManifest;
    toolSet.tools = generateToolsFromManifest(SkillsManifest);
    return toolSet;
  };

  it('keeps lobe-skills with only its read APIs once the owner grants any skill', () => {
    const toolSet = buildSkillsToolSet();

    applyShareGateToToolSet(toolSet, buildGate({ skillGrants: ['pdf-report'] }));

    const manifest = toolSet.manifestMap[SkillsIdentifier];
    expect(manifest.api.map((api) => api.name).sort()).toEqual(
      [SkillsApiName.activateSkill, SkillsApiName.readReference].sort(),
    );
    // The rewritten role must replace the full one: the original documents a
    // runCommand/execScript decision tree for APIs that are no longer callable.
    expect(manifest.systemRole).toBe(skillsAgentShareSystemPrompt);
    expect(manifest.systemRole).not.toContain('execScript');
    expect(toolSet.enabledToolIds).toContain(SkillsIdentifier);
    expect(toolSet.tools!.map((tool: any) => tool.function.name).sort()).toEqual(
      [
        toolName(SkillsIdentifier, SkillsApiName.activateSkill),
        toolName(SkillsIdentifier, SkillsApiName.readReference),
      ].sort(),
    );
  });

  it('drops lobe-skills entirely when the owner revoked every skill', () => {
    const toolSet = buildSkillsToolSet();

    applyShareGateToToolSet(toolSet, buildGate({ skillGrants: [] }));

    expect(toolSet.manifestMap[SkillsIdentifier]).toBeUndefined();
    expect(toolSet.enabledToolIds).toEqual([]);
    expect(toolSet.tools).toEqual([]);
  });

  it('drops lobe-skills on a share that grants nothing at all', () => {
    const toolSet = buildSkillsToolSet();

    applyShareGateToToolSet(toolSet, buildGate());

    expect(toolSet.manifestMap[SkillsIdentifier]).toBeUndefined();
    expect(toolSet.enabledToolIds).toEqual([]);
  });

  it('does not let an ordinary tool grant turn lobe-skills on', () => {
    // The skill list is the only opt-in. Granting some unrelated tool says
    // nothing about skills, so the Skills tool stays out of the visitor's set.
    const toolSet = buildSkillsToolSet();

    applyShareGateToToolSet(toolSet, buildGate({ toolGrants: [{ identifier: 'web-search' }] }));

    expect(toolSet.manifestMap[SkillsIdentifier]).toBeUndefined();
    expect(toolSet.enabledToolIds).toEqual([]);
  });

  it('preserves the restricted Agent Documents schema for a per-API grant', () => {
    const toolSet = buildToolSet([
      {
        apis: Object.values(AgentDocumentsApiName).map((name) => ({ name })),
        identifier: AgentDocumentsIdentifier,
      },
    ]);
    toolSet.manifestMap[AgentDocumentsIdentifier] = AgentDocumentsManifest;
    toolSet.tools = generateToolsFromManifest(AgentDocumentsManifest);

    applyShareGateToToolSet(
      toolSet,
      buildGate({
        toolGrants: [
          {
            apis: [AgentDocumentsApiName.createDocument],
            identifier: AgentDocumentsIdentifier,
          },
        ],
      }),
    );

    const manifest = toolSet.manifestMap[AgentDocumentsIdentifier];
    expect(manifest.api.map((api) => api.name)).toEqual([AgentDocumentsApiName.createDocument]);
    expect(manifest.meta?.description).toBe(
      'Use documents isolated to the current shared-agent topic.',
    );
    expect(manifest.systemRole).toBeUndefined();
    expect(Object.keys(manifest.api[0].parameters.properties).sort()).toEqual(['content', 'title']);
    expect(toolSet.tools).toHaveLength(1);
    expect(Object.keys(toolSet.tools![0].function.parameters.properties).sort()).toEqual([
      'content',
      'title',
    ]);
  });

  // Share runs honor the visitor's own approval mode, so granting a tool
  // grants its normal approval flow: intervention-gated APIs stay offered
  // WITH their config intact, which is what makes the runtime park them for
  // the visitor's approval instead of auto-running them.
  it('keeps intervention-gated apis and their humanIntervention config', () => {
    const toolSet = buildToolSet([
      {
        apis: [
          { name: 'safe' },
          { humanIntervention: 'required', name: 'needsApproval' },
          { humanIntervention: 'always', name: 'alwaysAsks' },
          { humanIntervention: { type: 'dynamic' }, name: 'maybeAsks' },
        ],
        identifier: CalculatorIdentifier,
      },
    ]);
    (toolSet.manifestMap[CalculatorIdentifier] as any).humanIntervention = 'required';

    applyShareGateToToolSet(
      toolSet,
      buildGate({ toolGrants: [{ identifier: CalculatorIdentifier }] }),
    );

    const manifest = toolSet.manifestMap[CalculatorIdentifier] as any;
    expect(manifest.humanIntervention).toBe('required');
    expect(manifest.api.map((api: any) => [api.name, api.humanIntervention])).toEqual([
      ['safe', undefined],
      ['needsApproval', 'required'],
      ['alwaysAsks', 'always'],
      ['maybeAsks', { type: 'dynamic' }],
    ]);
    expect(toolSet.tools).toHaveLength(4);
  });

  it('keeps a required-intervention API on a non-builtin (MCP/connector) manifest', () => {
    // Mirrors `buildConnectorManifests.ts`: a connector tool with the
    // `needs_approval` permission maps to `humanIntervention: 'required'`.
    // The config must survive so the visitor is asked before it runs.
    const toolSet = buildToolSet([
      {
        apis: [{ name: 'listRepos' }, { humanIntervention: 'required', name: 'deleteRepo' }],
        identifier: 'mcp-github',
        type: 'mcp',
      },
    ]);

    applyShareGateToToolSet(toolSet, buildGate({ toolGrants: [{ identifier: 'mcp-github' }] }));

    expect(
      toolSet.manifestMap['mcp-github'].api.map((api: any) => [api.name, api.humanIntervention]),
    ).toEqual([
      ['listRepos', undefined],
      ['deleteRepo', 'required'],
    ]);
  });

  it('narrows a per-API grant on a non-builtin (MCP) manifest, matching the real `____<type>`-suffixed generated name', () => {
    const toolSet = buildToolSet([
      {
        apis: [{ name: 'listRepos' }, { name: 'deleteRepo' }],
        identifier: 'mcp-github',
        type: 'mcp',
      },
    ]);
    toolSet.manifestMap['mcp-github'].systemRole =
      'Use listRepos and deleteRepo for repository operations.';

    // The grant in `shareConfig.toolGrants` names the RAW api name, independent
    // of whatever `ToolNameResolver.generate` does for the WIRE tool-call name
    // — the third `____mcp` segment only ever appears on the generated
    // dispatch name asserted below, never on the grant itself.
    applyShareGateToToolSet(
      toolSet,
      buildGate({ toolGrants: [{ apis: ['listRepos'], identifier: 'mcp-github' }] }),
    );

    expect(toolSet.manifestMap['mcp-github'].api.map((api) => api.name)).toEqual(['listRepos']);
    expect(toolSet.manifestMap['mcp-github'].systemRole).toBeUndefined();
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

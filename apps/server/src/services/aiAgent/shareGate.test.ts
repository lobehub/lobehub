import { AgentManagementManifest } from '@lobechat/builtin-tool-agent-management';
import { LobeAgentManifest } from '@lobechat/builtin-tool-lobe-agent';
import { describe, expect, it } from 'vitest';

import type { AgentShareGate, ShareGateToolSet } from './shareGate';
import {
  applyShareGateToAgentConfig,
  applyShareGateToToolSet,
  filterPluginsByShareGate,
} from './shareGate';

const buildGate = (config: Partial<AgentShareGate['shareConfig']> = {}): AgentShareGate => ({
  agentId: 'agent-1',
  shareConfig: {
    maxTopicsPerVisitor: 5,
    maxTurnsPerTopic: 20,
    ...config,
  },
  visitorUserId: 'visitor-1',
});

describe('filterPluginsByShareGate', () => {
  it('keeps only whitelisted plugin ids', () => {
    const gate = buildGate({ enabledToolIds: ['web-search', 'mcp-github'] });

    expect(filterPluginsByShareGate(['web-search', 'local-system', 'mcp-github'], gate)).toEqual([
      'web-search',
      'mcp-github',
    ]);
  });

  it('exposes no tools when the whitelist is missing or empty', () => {
    expect(filterPluginsByShareGate(['web-search'], buildGate())).toEqual([]);
    expect(filterPluginsByShareGate(['web-search'], buildGate({ enabledToolIds: [] }))).toEqual([]);
  });
});

describe('applyShareGateToAgentConfig', () => {
  it('strips files and knowledge bases unless explicitly readable', () => {
    const agentConfig = {
      files: [{ enabled: true, id: 'f1' }],
      knowledgeBases: [{ enabled: true, id: 'kb1' }],
    };

    applyShareGateToAgentConfig(agentConfig, buildGate());

    expect(agentConfig.files).toEqual([]);
    expect(agentConfig.knowledgeBases).toEqual([]);
  });

  it('keeps surfaces granted read access', () => {
    const agentConfig = {
      files: [{ enabled: true, id: 'f1' }],
      knowledgeBases: [{ enabled: true, id: 'kb1' }],
    };

    applyShareGateToAgentConfig(
      agentConfig,
      buildGate({
        filePermissionConfig: { agentFiles: 'read', knowledgeBase: 'read', uploadAllowed: false },
      }),
    );

    expect(agentConfig.files).toHaveLength(1);
    expect(agentConfig.knowledgeBases).toHaveLength(1);
  });

  it('applies surfaces independently', () => {
    const agentConfig = {
      files: [{ enabled: true, id: 'f1' }],
      knowledgeBases: [{ enabled: true, id: 'kb1' }],
    };

    applyShareGateToAgentConfig(
      agentConfig,
      buildGate({
        filePermissionConfig: { agentFiles: 'read', knowledgeBase: 'none', uploadAllowed: false },
      }),
    );

    expect(agentConfig.files).toHaveLength(1);
    expect(agentConfig.knowledgeBases).toEqual([]);
  });
});

describe('applyShareGateToToolSet', () => {
  // Simulates the fully-assembled operation tool set right before it's
  // persisted as `toolSet` — i.e. AFTER LobeHub Skill / Composio / real-MCP
  // connector manifests and the always-on builtin defaults have all been
  // merged in by `execAgent`, unconditionally, from the creator's own config.
  const buildToolSet = (): ShareGateToolSet => ({
    activatableToolIds: ['web-search', 'composio-github', 'lobe-agent'],
    enabledToolIds: ['web-search', 'lobe-activator'],
    executorMap: { 'composio-github': 'client' as any },
    manifestMap: {
      'composio-github': { api: [], identifier: 'composio-github', type: 'default' } as any,
      'lobe-activator': { api: [], identifier: 'lobe-activator', type: 'default' } as any,
      'web-search': { api: [], identifier: 'web-search', type: 'default' } as any,
    },
    sourceMap: { 'composio-github': 'composio', 'web-search': 'builtin' } as any,
    tools: [
      { function: { name: 'web-search____search' }, type: 'function' },
      { function: { name: 'composio-github____createIssue' }, type: 'function' },
    ],
  });

  it('collapses the tool set to nothing when the whitelist is missing or empty', () => {
    const gate = buildGate();
    const toolSet = buildToolSet();

    applyShareGateToToolSet(toolSet, gate);

    expect(toolSet.enabledToolIds).toEqual([]);
    expect(toolSet.activatableToolIds).toEqual([]);
    expect(toolSet.manifestMap).toEqual({});
    expect(toolSet.sourceMap).toEqual({});
    expect(toolSet.executorMap).toEqual({});
    expect(toolSet.tools).toEqual([]);
  });

  it('keeps only whitelisted identifiers across every surface — including the creator-connected Composio/discovery entries the initial plugin filter never touched', () => {
    const gate = buildGate({ enabledToolIds: ['web-search'] });
    const toolSet = buildToolSet();

    applyShareGateToToolSet(toolSet, gate);

    // `composio-github` and `lobe-activator` were never in shareConfig.enabledToolIds
    // (only the plugin-id filter upstream ever saw `web-search`), yet they were
    // still present in manifestMap/activatableToolIds — this is the discovery
    // surface `lobe-activator` and `ToolExecutionService` would otherwise use.
    expect(toolSet.enabledToolIds).toEqual(['web-search']);
    expect(toolSet.activatableToolIds).toEqual(['web-search']);
    expect(Object.keys(toolSet.manifestMap)).toEqual(['web-search']);
    expect(Object.keys(toolSet.sourceMap)).toEqual(['web-search']);
    expect(toolSet.executorMap).toEqual({});
    expect(toolSet.tools).toEqual([
      { function: { name: 'web-search____search' }, type: 'function' },
    ]);
  });

  it('mutates the caller-owned arrays/objects in place (no reassignment required)', () => {
    const gate = buildGate({ enabledToolIds: ['web-search'] });
    const toolSet = buildToolSet();
    const enabledToolIdsRef = toolSet.enabledToolIds;
    const manifestMapRef = toolSet.manifestMap;

    applyShareGateToToolSet(toolSet, gate);

    expect(toolSet.enabledToolIds).toBe(enabledToolIdsRef);
    expect(toolSet.manifestMap).toBe(manifestMapRef);
  });

  it('leaves a `tools: undefined` set untouched', () => {
    const gate = buildGate({ enabledToolIds: ['web-search'] });
    const toolSet = { ...buildToolSet(), tools: undefined };

    expect(() => applyShareGateToToolSet(toolSet, gate)).not.toThrow();
    expect(toolSet.tools).toBeUndefined();
  });

  it('strips sub-agent dispatch APIs even when the tool is explicitly whitelisted', () => {
    // Sub-agent dispatch is not available in shared visitor runs, regardless
    // of whether the manifest passed to `applyShareGateToToolSet` was already
    // context-aware trimmed or not — this reproduces the untrimmed shape by
    // using the REAL exported builtin manifests (not a hand-written fixture),
    // so the regression also catches a future edit to either systemRole that
    // reintroduces a callAgent/callSubAgent reference.
    const gate = buildGate({ enabledToolIds: ['lobe-agent-management', 'lobe-agent'] });
    const toolSet: ShareGateToolSet = {
      activatableToolIds: ['lobe-agent-management', 'lobe-agent'],
      enabledToolIds: ['lobe-agent-management', 'lobe-agent'],
      executorMap: {},
      manifestMap: {
        'lobe-agent': LobeAgentManifest,
        'lobe-agent-management': AgentManagementManifest,
      },
      sourceMap: {},
      tools: [
        { function: { name: 'lobe-agent-management____callAgent' }, type: 'function' },
        { function: { name: 'lobe-agent-management____searchAgent' }, type: 'function' },
        { function: { name: 'lobe-agent____callSubAgent' }, type: 'function' },
        { function: { name: 'lobe-agent____createPlan' }, type: 'function' },
      ],
    };

    applyShareGateToToolSet(toolSet, gate);

    // Both identifiers stay allowed (they were explicitly whitelisted)...
    expect(Object.keys(toolSet.manifestMap)).toEqual(
      expect.arrayContaining(['lobe-agent-management', 'lobe-agent']),
    );
    // ...but their sub-agent dispatch API is gone from every surface,
    const managementApiNames = toolSet.manifestMap['lobe-agent-management'].api.map(
      (api) => api.name,
    );
    const lobeAgentApiNames = toolSet.manifestMap['lobe-agent'].api.map((api) => api.name);
    expect(managementApiNames).not.toContain('callAgent');
    expect(managementApiNames).toContain('searchAgent');
    expect(lobeAgentApiNames).not.toContain('callSubAgent');
    expect(lobeAgentApiNames).toContain('createPlan');
    expect(toolSet.tools).toEqual([
      { function: { name: 'lobe-agent-management____searchAgent' }, type: 'function' },
      { function: { name: 'lobe-agent____createPlan' }, type: 'function' },
    ]);

    // ...and the systemRole no longer instructs the model to call either
    // dispatch tool (the exact leak this test guards against: a stale
    // systemRole prompting a call to a tool that was just removed).
    expect(toolSet.manifestMap['lobe-agent-management'].systemRole).not.toMatch(/callAgent/);
    expect(toolSet.manifestMap['lobe-agent'].systemRole).not.toMatch(/callSubAgent/);
    // ...including semantic phrasings that suggest dispatching to an agent
    // without naming the API.
    expect(toolSet.manifestMap['lobe-agent-management'].systemRole).not.toMatch(
      /Before calling an agent/,
    );
    expect(toolSet.manifestMap['lobe-agent-management'].systemRole).not.toMatch(
      /whether to call it/,
    );
  });
});

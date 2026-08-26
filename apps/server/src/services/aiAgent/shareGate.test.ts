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
});

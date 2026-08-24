import { describe, expect, it } from 'vitest';

import type { AgentShareGate } from './shareGate';
import { applyShareGateToAgentConfig, filterPluginsByShareGate } from './shareGate';

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

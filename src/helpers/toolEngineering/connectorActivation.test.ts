import { describe, expect, it } from 'vitest';

import type { ToolStoreState } from '@/store/tool/initialState';

import {
  applyAgentConnectorActivation,
  getConnectorIdentifiers,
  resolveAgentConnectorActivation,
} from './connectorActivation';

const toolState = {
  agentConnectors: { 'agent-1': [{ identifier: 'agent-only-mcp' }] },
  agentSkillListMap: { all: [{ identifier: 'library-skill' }] },
  builtinSkills: [{ identifier: 'builtin-skill' }],
  builtinTools: [{ identifier: 'lobe-image-generation' }],
  composioServers: [{ identifier: 'gmail' }],
  connectors: [{ identifier: 'custom-mcp' }, { identifier: 'lobe-image-generation' }],
  installedPlugins: [{ identifier: 'community-mcp' }, { identifier: 'library-skill' }],
  lobehubSkillServers: [{ identifier: 'linear' }],
} as unknown as ToolStoreState;

describe('getConnectorIdentifiers', () => {
  it('collects every connector source and leaves builtin tools and skills out', () => {
    expect(getConnectorIdentifiers(toolState).sort()).toEqual([
      'agent-only-mcp',
      'community-mcp',
      'custom-mcp',
      'gmail',
      'linear',
    ]);
  });
});

describe('resolveAgentConnectorActivation', () => {
  it('turns every connector off for an agent that has no entry for it', () => {
    const { offIds } = resolveAgentConnectorActivation({ plugins: [] }, [], toolState);

    expect(offIds.sort()).toEqual([
      'agent-only-mcp',
      'community-mcp',
      'custom-mcp',
      'gmail',
      'linear',
    ]);
  });

  it('keeps a connector on for an auto entry and for one pinned before the switch', () => {
    const { offIds } = resolveAgentConnectorActivation(
      {
        plugins: [
          'gmail',
          { identifier: 'linear', mode: 'auto' },
          { identifier: 'custom-mcp', mode: 'disabled' },
        ],
      },
      [],
      toolState,
    );

    expect(offIds).not.toContain('gmail');
    expect(offIds).not.toContain('linear');
    expect(offIds).toContain('custom-mcp');
  });

  it('keeps a connector the turn mentions reachable even when it is off', () => {
    const { offIds } = resolveAgentConnectorActivation({ plugins: [] }, ['custom-mcp'], toolState);

    expect(offIds).not.toContain('custom-mcp');
  });
});

describe('applyAgentConnectorActivation', () => {
  it('leaves a connector that is on to the activator and keeps pinned tools and skills', () => {
    const connectors = resolveAgentConnectorActivation(
      { plugins: ['gmail', 'lobe-image-generation', 'library-skill'] },
      [],
      toolState,
    );

    expect(
      applyAgentConnectorActivation(
        ['gmail', 'lobe-image-generation', 'library-skill'],
        connectors,
      ),
    ).toEqual(['lobe-image-generation', 'library-skill']);
  });

  it('keeps an opted-in connector discoverable despite a legacy manual preference', () => {
    const connectors = resolveAgentConnectorActivation(
      {
        chatConfig: { skillActivateMode: 'manual' },
        plugins: [{ identifier: 'linear', mode: 'auto' }],
      },
      [],
      toolState,
    );

    expect(connectors.offIds).not.toContain('linear');
    expect(applyAgentConnectorActivation(['linear'], connectors)).toEqual([]);
  });

  it('keeps a connector this turn mentions', () => {
    const connectors = resolveAgentConnectorActivation({ plugins: [] }, ['custom-mcp'], toolState);

    expect(applyAgentConnectorActivation(['custom-mcp'], connectors)).toEqual(['custom-mcp']);
  });
});

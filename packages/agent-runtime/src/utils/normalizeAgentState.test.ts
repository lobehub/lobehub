import { describe, expect, it } from 'vitest';

import type { AgentState } from '../types';
import { normalizeAgentState } from './normalizeAgentState';

const baseState = (): AgentState =>
  ({
    cost: { total: 0 },
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-01-01T00:00:00.000Z',
    messages: [],
    operationId: 'op_1',
    status: 'idle',
    stepCount: 0,
    toolManifestMap: {},
    usage: {},
  }) as unknown as AgentState;

describe('normalizeAgentState', () => {
  it('returns the same object when metadata carries no legacy keys', () => {
    const state = { ...baseState(), metadata: { userId: 'u1', _hooks: [] } };
    expect(normalizeAgentState(state)).toBe(state);
  });

  it('lifts legacy metadata keys into world and binding and strips them from metadata', () => {
    const state = {
      ...baseState(),
      metadata: {
        activeDeviceId: 'dev_1',
        agentConfig: { systemRole: 'hi' },
        agentGroup: { agentMap: {} },
        botPlatformContext: { platformName: 'slack', supportsMarkdown: true },
        connectorOwnershipNote: 'note',
        devicePlatform: 'darwin',
        deviceSystemInfo: { workingDirectory: '/tmp' },
        discordContext: { guildId: 'g' },
        evalContext: { caseId: 'c' },
        projectInstructions: [{ content: 'x', source: 'AGENTS.md' }],
        searchDecision: { enabledSearch: true },
        userId: 'u1',
        userMemory: { enabled: true },
        userTimezone: 'Asia/Shanghai',
      },
    };

    const normalized = normalizeAgentState(state);

    expect(normalized.world).toEqual({
      agent: { systemRole: 'hi' },
      channel: {
        botPlatform: { platformName: 'slack', supportsMarkdown: true },
        discord: { guildId: 'g' },
      },
      connectorOwnershipNote: 'note',
      eval: { caseId: 'c' },
      group: { agentMap: {} },
      projectInstructions: [{ content: 'x', source: 'AGENTS.md' }],
      searchDecision: { enabledSearch: true },
      userMemory: { enabled: true },
      userTimezone: 'Asia/Shanghai',
    });
    expect(normalized.binding).toEqual({
      device: { id: 'dev_1', platform: 'darwin', systemInfo: { workingDirectory: '/tmp' } },
    });
    expect(normalized.metadata).toEqual({ userId: 'u1' });
    // Input is not mutated.
    expect(state.metadata.agentConfig).toEqual({ systemRole: 'hi' });
  });

  it('keeps slot values over legacy keys when both are present', () => {
    const state = {
      ...baseState(),
      binding: { device: { id: 'dev_new' } },
      metadata: { activeDeviceId: 'dev_old', agentConfig: { systemRole: 'old' } },
      world: { agent: { systemRole: 'new' } as any },
    };

    const normalized = normalizeAgentState(state);

    expect(normalized.world?.agent).toEqual({ systemRole: 'new' });
    expect(normalized.binding?.device?.id).toBe('dev_new');
    expect(normalized.metadata).toEqual({});
  });

  it('lifts a partial device binding without inventing an id', () => {
    const state = {
      ...baseState(),
      metadata: { deviceSystemInfo: { workingDirectory: '/w' } },
    };

    const normalized = normalizeAgentState(state);

    expect(normalized.binding).toEqual({ device: { systemInfo: { workingDirectory: '/w' } } });
    expect(normalized.world).toBeUndefined();
  });
});

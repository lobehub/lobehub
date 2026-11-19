import { describe, expect, it } from 'vitest';

import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

import { buildAgentToolRows, countAvailableTools } from './agentToolRows';

const AGENT = 'agt_1';

const connector = (
  identifier: string,
  overrides: Partial<ConnectorWithTools> = {},
): ConnectorWithTools => ({
  agentId: AGENT,
  credentials: null,
  id: `row-${identifier}`,
  identifier,
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://example.com/mcp',
  metadata: null,
  name: identifier,
  sourceType: 'custom',
  status: 'connected',
  tools: [],
  ...overrides,
});

const option = (id: string, enabled: boolean, canDisable = true) => ({ canDisable, enabled, id });

describe('buildAgentToolRows', () => {
  it('lists the tools that are on, in the order the library lists them', () => {
    const rows = buildAgentToolRows({
      agentConnectors: [],
      agentId: AGENT,
      libraryOptions: [
        option('search', true, false),
        option('notion', false),
        option('linear', true),
      ],
      plugins: [{ identifier: 'linear', mode: 'auto' }],
    });

    expect(rows.map((row) => row.id)).toEqual(['search', 'linear']);
    expect(rows.every((row) => row.inLibrary && !row.ownConnection)).toBe(true);
    expect(rows[0].canDisable).toBe(false);
  });

  it('lists a tool once when the agent has its own connection and the library has one too', () => {
    const own = connector('notion');
    const rows = buildAgentToolRows({
      agentConnectors: [own],
      agentId: AGENT,
      libraryOptions: [option('notion', true), option('linear', true)],
      plugins: [
        { identifier: 'notion', mode: 'auto' },
        { identifier: 'linear', mode: 'auto' },
      ],
    });

    expect(rows.map((row) => row.id)).toEqual(['notion', 'linear']);
    expect(rows[0]).toMatchObject({ enabled: true, inLibrary: true, ownConnection: own });
    expect(rows[1].ownConnection).toBeUndefined();
  });

  it.each(['auto', 'disabled'] as const)(
    'keeps the own account switch editable and reflects its %s mode when the library account needs authorization',
    (mode) => {
      const own = connector('gmail', { metadata: { composio: { status: 'ACTIVE' } } });
      const rows = buildAgentToolRows({
        agentConnectors: [own],
        agentId: AGENT,
        libraryOptions: [option('gmail', false, false)],
        plugins: [{ identifier: 'gmail', mode }],
      });

      expect(rows).toMatchObject([
        { canDisable: true, enabled: mode === 'auto', ownConnection: own },
      ]);
    },
  );

  it('keeps a tool with its own connection in place when it is turned off', () => {
    const rows = buildAgentToolRows({
      agentConnectors: [connector('notion')],
      agentId: AGENT,
      libraryOptions: [option('notion', false), option('linear', true)],
      plugins: [{ identifier: 'notion', mode: 'disabled' }],
    });

    expect(rows.map((row) => [row.id, row.enabled])).toEqual([
      ['notion', false],
      ['linear', true],
    ]);
  });

  it('lets a tool on its own connection be switched whatever state the library connection is in', () => {
    // A library connection awaiting authorization cannot be switched; the agent's own
    // connection works without it.
    const rows = buildAgentToolRows({
      agentConnectors: [connector('gmail')],
      agentId: AGENT,
      libraryOptions: [option('gmail', true, false), option('search', true, false)],
      plugins: [{ identifier: 'gmail', mode: 'auto' }],
    });

    expect(rows.map((row) => [row.id, row.canDisable])).toEqual([
      ['gmail', true],
      ['search', false],
    ]);
  });

  it('adds the tools only this agent has after the library ones, with their own switch', () => {
    const rows = buildAgentToolRows({
      agentConnectors: [connector('sentry'), connector('jira')],
      agentId: AGENT,
      libraryOptions: [option('search', true)],
      plugins: [{ identifier: 'sentry', mode: 'auto' }],
    });

    expect(rows.map((row) => [row.id, row.enabled, row.inLibrary])).toEqual([
      ['search', true, true],
      ['sentry', true, false],
      ['jira', true, false],
    ]);
  });

  it('keeps unconfigured own connectors off in a custom toolset, including those also in the library', () => {
    const rows = buildAgentToolRows({
      agentConnectors: [connector('sentry'), connector('jira')],
      agentId: AGENT,
      chatConfig: { toolMode: 'custom' },
      libraryOptions: [option('jira', false)],
      plugins: [],
    });

    expect(rows.map(({ id, enabled }) => [id, enabled])).toEqual([
      ['jira', false],
      ['sentry', false],
    ]);
  });

  it('treats a library connection lent to the agent as the library connection', () => {
    const lent = connector('notion', {
      agentId: null,
      metadata: { mountedByAgentId: AGENT },
    });
    const rows = buildAgentToolRows({
      agentConnectors: [lent],
      agentId: AGENT,
      libraryOptions: [option('notion', true)],
      plugins: [{ identifier: 'notion', mode: 'auto' }],
    });

    expect(rows).toEqual([
      { canDisable: true, enabled: true, id: 'notion', inLibrary: true, ownConnection: undefined },
    ]);
  });
});

describe('countAvailableTools', () => {
  it('counts the tools only this agent has on top of the library total', () => {
    const rows = buildAgentToolRows({
      agentConnectors: [connector('notion'), connector('sentry')],
      agentId: AGENT,
      libraryOptions: [option('notion', true)],
      plugins: [],
    });

    expect(countAvailableTools(rows, 26)).toBe(27);
  });
});

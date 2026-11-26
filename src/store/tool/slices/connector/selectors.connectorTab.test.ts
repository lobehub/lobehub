import { describe, expect, it } from 'vitest';

import type { ToolStore } from '@/store/tool/store';

import {
  connectorSelectors,
  isInConnectorTab,
  isIntegrationInConnectorTab,
  pickRunConnectors,
  pickRunToolSets,
} from './selectors';
import type { ConnectorWithTools } from './types';

const connector = (patch: Partial<ConnectorWithTools>): ConnectorWithTools => ({
  credentials: null,
  id: 'c1',
  identifier: 'linear',
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://mcp.example/linear',
  metadata: null,
  name: 'Linear',
  sourceType: 'custom',
  status: 'connected',
  tools: [],
  ...patch,
});

const sharedRow = connector({ id: 'shared-row', visibility: 'public' });
const privateRow = connector({ id: 'private-row', visibility: 'private' });
// A row from a server that predates visibility is shared
const legacyRow = connector({ id: 'legacy-row' });

describe('isInConnectorTab', () => {
  it('lists private rows under the private tab and every other row under the shared one', () => {
    expect(isInConnectorTab(privateRow, 'private')).toBe(true);
    expect(isInConnectorTab(sharedRow, 'private')).toBe(false);
    expect(isInConnectorTab(legacyRow, 'private')).toBe(false);

    expect(isInConnectorTab(sharedRow, 'public')).toBe(true);
    expect(isInConnectorTab(legacyRow, 'public')).toBe(true);
    expect(isInConnectorTab(privateRow, 'public')).toBe(false);
  });

  it('lists every row without a tab (outside a workspace)', () => {
    expect([sharedRow, privateRow, legacyRow].every((c) => isInConnectorTab(c))).toBe(true);
  });
});

describe('connectorSelectors.connectorByIdentifier', () => {
  const state = (connectors: ConnectorWithTools[]) => ({ connectors }) as unknown as ToolStore;

  it('opens the row of the tab it was picked from when two rows share an identifier', () => {
    for (const rows of [
      [sharedRow, privateRow],
      [privateRow, sharedRow],
    ]) {
      expect(connectorSelectors.connectorByIdentifier('linear', 'private')(state(rows))?.id).toBe(
        'private-row',
      );
      expect(connectorSelectors.connectorByIdentifier('linear', 'public')(state(rows))?.id).toBe(
        'shared-row',
      );
    }
  });

  it('falls back to the first row without a tab or a row of that tab', () => {
    expect(connectorSelectors.connectorByIdentifier('linear')(state([privateRow]))?.id).toBe(
      'private-row',
    );
    expect(
      connectorSelectors.connectorByIdentifier('linear', 'private')(state([sharedRow]))?.id,
    ).toBe('shared-row');
    expect(connectorSelectors.connectorByIdentifier('missing')(state([sharedRow]))).toBe(undefined);
  });
});

describe('isIntegrationInConnectorTab', () => {
  // A Composio connection's row: endpoint-less, named by the app identifier
  const gmail = (id: string, visibility: 'private' | 'public') =>
    connector({
      id,
      identifier: 'gmail',
      mcpServerUrl: null,
      sourceType: 'composio' as never,
      visibility,
    });

  it('lists an integration whose only row is private under the private tab alone', () => {
    // Regression: the private tab hid every OAuth integration, so a Composio
    // connection made private showed the empty state there and stayed listed
    // under the shared tab.
    const rows = [gmail('my-gmail', 'private')];

    expect(isIntegrationInConnectorTab('gmail', rows, 'private')).toBe(true);
    expect(isIntegrationInConnectorTab('gmail', rows, 'public')).toBe(false);
  });

  it('lists an integration with a shared row under the shared tab', () => {
    expect(isIntegrationInConnectorTab('gmail', [gmail('ws-gmail', 'public')], 'public')).toBe(
      true,
    );
    expect(isIntegrationInConnectorTab('gmail', [gmail('ws-gmail', 'public')], 'private')).toBe(
      false,
    );
  });

  it('lists an integration with both rows under both tabs', () => {
    const rows = [gmail('ws-gmail', 'public'), gmail('my-gmail', 'private')];

    expect(isIntegrationInConnectorTab('gmail', rows, 'public')).toBe(true);
    expect(isIntegrationInConnectorTab('gmail', rows, 'private')).toBe(true);
  });

  it('keeps an integration nobody connected with the shared pool, and lists all without a tab', () => {
    expect(isIntegrationInConnectorTab('gmail', [], 'public')).toBe(true);
    expect(isIntegrationInConnectorTab('gmail', [], 'private')).toBe(false);
    expect(isIntegrationInConnectorTab('gmail', [gmail('my-gmail', 'private')])).toBe(true);
  });
});

describe('isIntegrationInConnectorTab: an entry bound to one account', () => {
  const composioRow = (id: string, visibility: 'private' | 'public', accountId: string) =>
    connector({
      id,
      identifier: 'gmail',
      mcpServerUrl: null,
      metadata: { composio: { connectedAccountId: accountId } },
      visibility,
    });
  const rows = [
    composioRow('ws-gmail', 'public', 'ca_team'),
    composioRow('my-gmail', 'private', 'ca_mine'),
  ];

  it('lists under the tab of the row holding the account its actions act on, never both', () => {
    // Regression: with a private and a shared row, the entry listed under both
    // tabs, but the store holds one connection per identifier, so Disconnect in
    // the Private tab could remove the shared workspace connection.
    expect(isIntegrationInConnectorTab('gmail', rows, 'private', 'ca_mine')).toBe(true);
    expect(isIntegrationInConnectorTab('gmail', rows, 'public', 'ca_mine')).toBe(false);

    expect(isIntegrationInConnectorTab('gmail', rows, 'public', 'ca_team')).toBe(true);
    expect(isIntegrationInConnectorTab('gmail', rows, 'private', 'ca_team')).toBe(false);
  });

  it('keeps an account no row names with the shared pool', () => {
    expect(isIntegrationInConnectorTab('gmail', rows, 'public', 'ca_legacy')).toBe(true);
    expect(isIntegrationInConnectorTab('gmail', rows, 'private', 'ca_legacy')).toBe(false);
  });
});

describe('connectorSelectors.sharedConnectorByIdentifier', () => {
  const state = (connectors: ConnectorWithTools[]) => ({ connectors }) as unknown as ToolStore;

  it('reads the shared row whichever order the list holds them in, and never a private one', () => {
    for (const rows of [
      [sharedRow, privateRow],
      [privateRow, sharedRow],
    ]) {
      expect(connectorSelectors.sharedConnectorByIdentifier('linear')(state(rows))?.id).toBe(
        'shared-row',
      );
    }
    expect(connectorSelectors.sharedConnectorByIdentifier('linear')(state([privateRow]))).toBe(
      undefined,
    );
    expect(connectorSelectors.sharedConnectorByIdentifier('linear')(state([legacyRow]))?.id).toBe(
      'legacy-row',
    );
  });
});

describe('pickRunConnectors', () => {
  const ids = (rows: ConnectorWithTools[]) => rows.map((c) => c.id);

  it("runs the owner's private row of an identifier the workspace also shares, in either order", () => {
    for (const rows of [
      [sharedRow, privateRow],
      [privateRow, sharedRow],
    ]) {
      expect(ids(pickRunConnectors(rows, { includePrivate: true }))).toEqual(['private-row']);
      expect(ids(pickRunConnectors(rows, { includePrivate: false }))).toEqual(['shared-row']);
    }
  });

  it('keeps the lowest id among rows of equal rank, as the server orders them', () => {
    const a = connector({ id: 'a-row', visibility: 'public' });
    const b = connector({ id: 'b-row', visibility: 'public' });

    expect(ids(pickRunConnectors([b, a], { includePrivate: true }))).toEqual(['a-row']);
    expect(ids(pickRunConnectors([a, b], { includePrivate: true }))).toEqual(['a-row']);
  });

  it('leaves out a row mounted on another agent, so the shared row still serves', () => {
    // Regression: a private row mounted on another agent shadowed the shared
    // row here, then dropped out as disabled, leaving the agent without tools.
    const mountedElsewhere = connector({
      id: 'a-private',
      metadata: { mountedByAgentId: 'agt-other' },
      visibility: 'private',
    });

    expect(
      ids(
        pickRunConnectors([mountedElsewhere, sharedRow], {
          agentId: 'agt-me',
          includePrivate: true,
        }),
      ),
    ).toEqual(['shared-row']);
    // Without an agent no mounted row runs
    expect(ids(pickRunConnectors([mountedElsewhere, sharedRow], { includePrivate: true }))).toEqual(
      ['shared-row'],
    );
  });

  it('runs the row mounted on the agent over a free one, as the server ranks them', () => {
    const mountedHere = connector({
      id: 'z-mounted',
      metadata: { mountedByAgentId: 'agt-me' },
      visibility: 'public',
    });

    expect(
      ids(
        pickRunConnectors([privateRow, mountedHere], { agentId: 'agt-me', includePrivate: true }),
      ),
    ).toEqual(['z-mounted']);
  });

  it('keeps one row per identifier in list order', () => {
    const notion = connector({ id: 'notion-row', identifier: 'notion', visibility: 'private' });

    expect(ids(pickRunConnectors([sharedRow, notion], { includePrivate: true }))).toEqual([
      'shared-row',
      'notion-row',
    ]);
    expect(ids(pickRunConnectors([sharedRow, notion], { includePrivate: false }))).toEqual([
      'shared-row',
    ]);
  });
});

describe('pickRunToolSets', () => {
  const prefixes = (rows: { toolIdentifier: string }[]) => rows.map((c) => c.toolIdentifier);
  const mine = connector({ id: '3f9a1c2e-mine', visibility: 'private' });

  it('keeps the shared and the private row each as its own tool set', () => {
    expect(prefixes(pickRunToolSets([mine, sharedRow], { includePrivate: true }))).toEqual([
      'linear-3f9a1c2e',
      'linear',
    ]);
    expect(prefixes(pickRunToolSets([mine, sharedRow], { includePrivate: false }))).toEqual([
      'linear',
    ]);
  });

  it("lets a row mounted on the run's agent stand alone, and leaves out other agents' mounts", () => {
    const mountedHere = connector({ id: 'z-here', metadata: { mountedByAgentId: 'agt-me' } });
    const mountedElsewhere = connector({ id: 'a-else', metadata: { mountedByAgentId: 'agt-x' } });

    expect(
      pickRunToolSets([mine, sharedRow, mountedHere, mountedElsewhere], {
        agentId: 'agt-me',
        includePrivate: true,
      }).map((c) => c.id),
    ).toEqual(['z-here']);
    expect(
      pickRunToolSets([sharedRow, mountedElsewhere], {
        agentId: 'agt-me',
        includePrivate: true,
      }).map((c) => c.id),
    ).toEqual(['shared-row']);
  });
});

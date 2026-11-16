import { describe, expect, it } from 'vitest';

import type { ToolStore } from '@/store/tool/store';

import { connectorSelectors, isInConnectorTab, pickRunConnectors } from './selectors';
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

import { describe, expect, it } from 'vitest';

import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

import { agentMenuConnectors, agentStillLoadsIdentifier } from './agentMenuConnectors';

const connector = (patch: Partial<ConnectorWithTools>): ConnectorWithTools => ({
  credentials: null,
  id: 'c1',
  identifier: 'team-linear',
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://mcp.example/linear',
  metadata: null,
  name: 'Team Linear',
  sourceType: 'custom',
  status: 'connected',
  tools: [],
  visibility: 'public',
  ...patch,
});

const shared = connector({ id: 'shared-linear' });
const myNotion = connector({ id: 'my-notion', identifier: 'my-notion', visibility: 'private' });
// The caller's private connection of an identifier the workspace also shares
const myLinear = connector({ id: 'my-linear', visibility: 'private' });

const ids = (rows: ConnectorWithTools[]) => rows.map((c) => c.id);

describe('agentMenuConnectors', () => {
  it("never offers the caller's private connectors to a workspace agent", () => {
    expect(
      ids(
        agentMenuConnectors([shared, myNotion, myLinear], {
          inWorkspace: true,
          privateAgent: false,
        }),
      ),
    ).toEqual(['shared-linear']);
  });

  it('offers a private agent the shared connectors plus its owner’s private ones', () => {
    expect(
      ids(agentMenuConnectors([shared, myNotion], { inWorkspace: true, privateAgent: true })),
    ).toEqual(['shared-linear', 'my-notion']);
  });

  it('keeps the private row of an identifier the workspace also shares, as the run does', () => {
    // Either physical order: the private connection is the one that executes
    for (const rows of [
      [shared, myLinear],
      [myLinear, shared],
    ]) {
      expect(ids(agentMenuConnectors(rows, { inWorkspace: true, privateAgent: true }))).toEqual([
        'my-linear',
      ]);
    }
  });

  it('lists every connector outside a workspace', () => {
    expect(
      ids(agentMenuConnectors([shared, myNotion], { inWorkspace: false, privateAgent: false })),
    ).toEqual(['shared-linear', 'my-notion']);
  });
});

describe('agentStillLoadsIdentifier', () => {
  const privateAgent = { inWorkspace: true, privateAgent: true };

  it('keeps the pin when a deleted private row leaves the shared row it shadowed', () => {
    // Regression: deleting the private row unpinned the identifier, so the
    // shared connector that now serves it disappeared from the agent.
    expect(agentStillLoadsIdentifier([shared, myLinear], myLinear, privateAgent)).toBe(true);
  });

  it('drops the pin when no row of the identifier is left', () => {
    expect(agentStillLoadsIdentifier([shared, myNotion], myNotion, privateAgent)).toBe(false);
    expect(agentStillLoadsIdentifier([shared], shared, privateAgent)).toBe(false);
  });

  it('does not count a private row a workspace agent never loads', () => {
    expect(
      agentStillLoadsIdentifier([shared, myLinear], shared, {
        inWorkspace: true,
        privateAgent: false,
      }),
    ).toBe(false);
  });
});

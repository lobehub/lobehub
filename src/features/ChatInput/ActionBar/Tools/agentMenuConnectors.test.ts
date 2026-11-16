import { describe, expect, it } from 'vitest';

import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

import { agentMenuConnectors } from './agentMenuConnectors';

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

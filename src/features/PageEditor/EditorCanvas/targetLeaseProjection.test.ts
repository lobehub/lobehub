import { describe, expect, it } from 'vitest';

import { createPageRewriteTargetLeases } from './targetLeaseProjection';

const request = (overrides: Record<string, unknown> = {}) =>
  ({
    agentId: 'agent-1',
    attempt: 1,
    createdAt: '2026-09-03T00:00:00.000Z',
    documentId: 'page-1',
    expiresAt: '2026-09-03T00:10:00.000Z',
    id: 'request-1',
    instruction: 'Rewrite this card',
    selection: {
      adapterId: 'artifact',
      sourceHash: 'hash:source',
      targetKind: 'node',
      targetNodeId: 'artifact-1',
      targetNodeIds: ['artifact-1'],
    },
    sessionId: 'session-1',
    status: 'writing' as const,
    turnIndex: 1,
    updatedAt: '2026-09-03T00:01:00.000Z',
    ...overrides,
  }) as never;

describe('createPageRewriteTargetLeases', () => {
  it('projects active node requests to durable leases and removes terminal rows', () => {
    expect(
      createPageRewriteTargetLeases({
        documentId: 'page-1',
        now: Date.parse('2026-09-03T00:02:00.000Z'),
        requests: [request(), request({ id: 'done', status: 'applied' })],
      }),
    ).toMatchObject([
      {
        capabilities: { delete: true, edit: true, move: true, select: true },
        id: 'rewrite-request:request-1:artifact-1',
        ownerId: 'rewrite-request:request-1',
        requestId: 'request-1',
        sessionId: 'session-1',
        target: { documentId: 'page-1', nodeId: 'artifact-1', targetKind: 'node' },
      },
    ]);
  });

  it('merges awareness projection with request state and retains the owner label', () => {
    const leases = createPageRewriteTargetLeases({
      awarenessUsers: [
        {
          clientId: 42,
          state: {
            awarenessData: {
              documentId: 'page-1',
              requestId: 'request-awareness',
              sessionId: 'session-awareness',
              status: 'writing',
              targetNodeIds: ['code-1'],
            },
            name: '文稿助理',
          } as never,
        },
      ],
      documentId: 'page-1',
      now: Date.parse('2026-09-03T00:02:00.000Z'),
    });

    expect(leases).toMatchObject([
      {
        ownerId: 'request-awareness',
        ownerLabel: '文稿助理',
        requestId: 'request-awareness',
        target: { nodeId: 'code-1', targetKind: 'node' },
      },
    ]);
  });

  it('does not project another document or expired request', () => {
    expect(
      createPageRewriteTargetLeases({
        documentId: 'page-1',
        now: Date.parse('2026-09-03T00:20:00.000Z'),
        requests: [request(), request({ documentId: 'page-2' })],
      }),
    ).toHaveLength(0);
  });
});

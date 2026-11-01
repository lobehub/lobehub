// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { shareChatRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('shareChatRouter procedures', () => {
  const procedures = (shareChatRouter as any)._def.procedures as Record<string, any>;

  it('exposes exactly the expected procedure paths', () => {
    expect(Object.keys(procedures).sort()).toEqual(expected().map(([name]) => name));
  });

  it.each(expected())('%s is a %s with %i middlewares', (name, type, middlewares) => {
    expect(procedures[name]._def.type).toBe(type);
    expect(procedures[name]._def.middlewares).toHaveLength(middlewares);
  });
});

function expected(): Array<
  [name: string, type: 'mutation' | 'query' | 'subscription', middlewares: number]
> {
  return [
    ['abortUpload', 'mutation', 11],
    ['createFile', 'mutation', 11],
    ['createUploadUrl', 'mutation', 11],
    ['execAgent', 'mutation', 11],
    ['getDocument', 'query', 11],
    ['getMessages', 'query', 11],
    ['getTopics', 'query', 11],
    ['interruptTask', 'mutation', 11],
    ['issueGatewayUserToken', 'query', 11],
    ['refreshGatewayToken', 'query', 11],
    ['removeFile', 'mutation', 11],
    ['resolveInterventionBySource', 'mutation', 11],
    ['setQueuedMessages', 'mutation', 11],
    ['stopPendingApproval', 'mutation', 11],
  ];
}

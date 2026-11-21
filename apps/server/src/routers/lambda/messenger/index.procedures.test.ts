// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { messengerRouter } from './index';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('messengerRouter procedures', () => {
  const procedures = (messengerRouter as any)._def.procedures as Record<string, any>;

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
    ['availablePlatforms', 'query', 10],
    ['confirmLink', 'mutation', 11],
    ['createLinqLink', 'mutation', 10],
    ['createWechatQrSession', 'mutation', 10],
    ['getMessengerPushWindow', 'query', 11],
    ['getMyLink', 'query', 11],
    ['listAgentsForBinding', 'query', 11],
    ['listBindingScopes', 'query', 10],
    ['listMyInstallations', 'query', 10],
    ['listMyLinks', 'query', 10],
    ['peekLinkToken', 'query', 7],
    ['pollLinqLink', 'query', 11],
    ['pollWechatQrSession', 'mutation', 11],
    ['sendMessengerPush', 'mutation', 11],
    ['setActiveAgent', 'mutation', 11],
    ['uninstallInstallation', 'mutation', 12],
    ['unlink', 'mutation', 12],
  ];
}

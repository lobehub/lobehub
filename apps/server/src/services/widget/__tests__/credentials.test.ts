import { describe, expect, it, vi } from 'vitest';

import type { DecryptedConnector } from '@/database/models/connector';
import { ensureFreshConnectorToken } from '@/server/services/connector/tokens';

import {
  credentialToSecret,
  ForbiddenWidgetCredentialsError,
  MissingWidgetEnvError,
  resolveWidgetEnv,
  type WidgetCredentialScope,
} from '../credentials';

vi.mock('@/server/services/connector/tokens', () => ({
  ensureFreshConnectorToken: vi.fn(async (connector) => connector),
}));

const connector = (overrides: Partial<DecryptedConnector>): DecryptedConnector =>
  ({
    agentId: null,
    credentials: { token: 'tok', type: 'bearer' },
    identifier: 'github',
    isEnabled: true,
    status: 'connected',
    userId: 'u1',
    workspaceId: null,
    ...overrides,
  }) as DecryptedConnector;

const modelReturning = (rows: DecryptedConnector[]) => ({
  resolveByIdentifiers: vi.fn().mockResolvedValue(rows),
  update: vi.fn(),
});

const personal: WidgetCredentialScope = {
  agentId: null,
  authorUserId: 'u1',
  projectId: null,
  userId: 'u1',
  workspaceId: null,
};
const workspace: WidgetCredentialScope = { ...personal, workspaceId: 'ws1' };

describe('credentialToSecret', () => {
  it.each([
    [{ accessToken: 'a', type: 'oauth2' }, 'a'],
    [{ token: 'b', type: 'bearer' }, 'b'],
    [{ apiKey: 'c', type: 'apikey' }, 'c'],
    [{ headers: { Authorization: 'Bearer d' }, type: 'header' }, 'd'],
  ] as const)('extracts the secret from %o', (credentials, expected) => {
    expect(credentialToSecret(credentials as any)).toBe(expected);
  });

  it('returns undefined without credentials', () => {
    expect(credentialToSecret(null)).toBeUndefined();
  });
});

describe('resolveWidgetEnv', () => {
  it('returns an empty env when nothing is declared', async () => {
    const model = modelReturning([]);

    expect(
      await resolveWidgetEnv({} as any, personal, undefined, { connectorModel: model as any }),
    ).toEqual({});
    expect(model.resolveByIdentifiers).not.toHaveBeenCalled();
  });

  it('resolves through the agent-aware chain on the widget scope', async () => {
    const model = modelReturning([
      connector({ credentials: { token: 'agent-tok', type: 'bearer' } }),
    ]);

    const env = await resolveWidgetEnv(
      {} as any,
      { ...personal, agentId: 'agt_1' },
      [{ connector: 'github', name: 'GITHUB_TOKEN' }],
      { connectorModel: model as any },
    );

    expect(env).toEqual({ GITHUB_TOKEN: 'agent-tok' });
    expect(model.resolveByIdentifiers).toHaveBeenCalledWith(['github'], 'agt_1');
  });

  it('never lets a personal credential reach a workspace widget', async () => {
    const model = modelReturning([connector({ workspaceId: null })]);

    await expect(
      resolveWidgetEnv({} as any, workspace, [{ connector: 'github', name: 'GITHUB_TOKEN' }], {
        connectorModel: model as any,
      }),
    ).rejects.toBeInstanceOf(MissingWidgetEnvError);
  });

  it('skips disabled connectors and connectors without credentials', async () => {
    const model = modelReturning([
      connector({ isEnabled: false }),
      connector({ credentials: null, identifier: 'linear' }),
    ]);

    const error = await resolveWidgetEnv(
      {} as any,
      personal,
      [
        { connector: 'github', name: 'GITHUB_TOKEN' },
        { connector: 'linear', name: 'LINEAR_TOKEN' },
      ],
      { connectorModel: model as any },
    ).catch((e) => e);

    expect(error).toBeInstanceOf(MissingWidgetEnvError);
    expect(error.missing.map((m: { name: string }) => m.name)).toEqual([
      'GITHUB_TOKEN',
      'LINEAR_TOKEN',
    ]);
  });

  it('uses an API-key connector whose tool sync never ran (status disconnected)', async () => {
    const model = modelReturning([connector({ status: 'disconnected' })]);

    const env = await resolveWidgetEnv(
      {} as any,
      personal,
      [{ connector: 'github', name: 'GITHUB_TOKEN' }],
      { connectorModel: model as any },
    );

    expect(env).toEqual({ GITHUB_TOKEN: 'tok' });
  });

  it('lists every missing required variable in one explicit error', async () => {
    const error = await resolveWidgetEnv(
      {} as any,
      workspace,
      [
        { connector: 'github', name: 'GITHUB_TOKEN' },
        { name: 'ORG' },
        { connector: 'slack', name: 'SLACK_TOKEN', required: false },
      ],
      { connectorModel: modelReturning([]) as any },
    ).catch((e) => e);

    expect(error).toBeInstanceOf(MissingWidgetEnvError);
    expect(error.message).toBe(
      'Missing required environment: GITHUB_TOKEN (connect "github" for this widget\'s agent or workspace); ORG (no connector declared to provide it)',
    );
  });

  it('leaves optional variables out when they cannot be resolved', async () => {
    const env = await resolveWidgetEnv(
      {} as any,
      workspace,
      [{ connector: 'slack', name: 'SLACK_TOKEN', required: false }],
      { connectorModel: modelReturning([]) as any },
    );

    expect(env).toEqual({});
  });

  describe('who may receive a connector secret', () => {
    const teammates = connector({ userId: 'u2', workspaceId: 'ws1' });
    const requirement = [{ connector: 'github', name: 'GITHUB_TOKEN' }];

    it('refuses a workspace connector another member created, before touching its token', async () => {
      const isWorkspaceOwner = vi.fn().mockResolvedValue(false);
      vi.mocked(ensureFreshConnectorToken).mockClear();

      const error = await resolveWidgetEnv({} as any, workspace, requirement, {
        connectorModel: modelReturning([teammates]) as any,
        isWorkspaceOwner,
      }).catch((e) => e);

      expect(error).toBeInstanceOf(ForbiddenWidgetCredentialsError);
      expect(error.connectors).toEqual(['github']);
      expect(isWorkspaceOwner).toHaveBeenCalledWith('u1', 'ws1');
      expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
    });

    it('lets the workspace owner use any workspace connector', async () => {
      const env = await resolveWidgetEnv({} as any, workspace, requirement, {
        connectorModel: modelReturning([teammates]) as any,
        isWorkspaceOwner: vi.fn().mockResolvedValue(true),
      });

      expect(env).toEqual({ GITHUB_TOKEN: 'tok' });
    });

    it('lets the creator use their own workspace connector without an owner lookup', async () => {
      const isWorkspaceOwner = vi.fn();

      const env = await resolveWidgetEnv({} as any, workspace, requirement, {
        connectorModel: modelReturning([connector({ workspaceId: 'ws1' })]) as any,
        isWorkspaceOwner,
      });

      expect(env).toEqual({ GITHUB_TOKEN: 'tok' });
      expect(isWorkspaceOwner).not.toHaveBeenCalled();
    });

    it('injects nothing once the author no longer exists', async () => {
      await expect(
        resolveWidgetEnv({} as any, { ...workspace, authorUserId: null }, requirement, {
          connectorModel: modelReturning([connector({ workspaceId: 'ws1' })]) as any,
          isWorkspaceOwner: vi.fn().mockResolvedValue(true),
        }),
      ).rejects.toBeInstanceOf(ForbiddenWidgetCredentialsError);
    });
  });
});

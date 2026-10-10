// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedInstallation } from '../platforms/types';
import { completeOAuthBind, failOAuthBind } from './oauthBind';

const mocks = vi.hoisted(() => ({
  findByPlatformUser: vi.fn(),
  greetAfterBind: vi.fn(),
  peekBindSession: vi.fn(),
  settleBindSession: vi.fn(),
  upsertForPlatform: vi.fn(),
}));

vi.mock('./greeting', () => ({ greetAfterBind: mocks.greetAfterBind }));
vi.mock('./sessionStore', () => ({
  isBindSessionExpired: (session: { createdAt: number }) => session.createdAt < 0,
  peekBindSession: mocks.peekBindSession,
  settleBindSession: mocks.settleBindSession,
}));
vi.mock('@/database/models/messengerAccountLink', () => {
  class MessengerAccountLinkConflictError extends Error {}
  class MessengerAccountLinkRelinkRequiredError extends Error {}
  class MessengerAccountLinkModel {
    static findByPlatformUser = mocks.findByPlatformUser;
    constructor(
      _db: unknown,
      public userId: string,
    ) {}
    upsertForPlatform = (params: unknown) => mocks.upsertForPlatform(this.userId, params);
  }
  return {
    MessengerAccountLinkConflictError,
    MessengerAccountLinkModel,
    MessengerAccountLinkRelinkRequiredError,
  };
});

const serverDB = {} as any;

const install = (overrides: Partial<NormalizedInstallation> = {}): NormalizedInstallation => ({
  accountId: 'B1',
  applicationId: 'A1',
  credentials: {},
  installedByPlatformUserId: 'U_ALICE',
  metadata: {},
  tenantId: 'T_ACME',
  tokenExpiresAt: null,
  ...overrides,
});

const pendingSession = (platform: 'slack' | 'discord') => ({
  agentId: 'agent-toby',
  createdAt: 0,
  kind: 'oauth',
  locale: 'en-US',
  platform,
  pollId: 'poll-1',
  result: { status: 'pending' },
  userId: 'user-alice',
  workspaceId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findByPlatformUser.mockResolvedValue(undefined);
  mocks.upsertForPlatform.mockResolvedValue({ id: 'link-1' });
  mocks.greetAfterBind.mockResolvedValue('sent');
});

describe('completeOAuthBind', () => {
  it('links the Slack user who approved the install to that workspace, then greets', async () => {
    mocks.peekBindSession.mockResolvedValue(pendingSession('slack'));

    const result = await completeOAuthBind({
      install: install(),
      platform: 'slack',
      pollId: 'poll-1',
      serverDB,
      userId: 'user-alice',
    });

    expect(result).toMatchObject({ platformUserId: 'U_ALICE', status: 'linked' });
    expect(mocks.upsertForPlatform).toHaveBeenCalledWith('user-alice', {
      activeAgentId: 'agent-toby',
      platform: 'slack',
      platformUserId: 'U_ALICE',
      platformUsername: null,
      tenantId: 'T_ACME',
      workspaceId: null,
    });
    expect(mocks.settleBindSession).toHaveBeenCalledWith(
      'poll-1',
      expect.objectContaining({ status: 'linked' }),
    );
    expect(mocks.greetAfterBind).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-toby', platform: 'slack', tenantId: 'T_ACME' }),
    );
  });

  it('links Discord platform-wide (empty tenant), like verify-im does', async () => {
    mocks.peekBindSession.mockResolvedValue(pendingSession('discord'));

    await completeOAuthBind({
      install: install({ tenantId: 'GUILD_1' }),
      platform: 'discord',
      pollId: 'poll-1',
      serverDB,
      userId: 'user-alice',
    });

    expect(mocks.upsertForPlatform).toHaveBeenCalledWith(
      'user-alice',
      expect.objectContaining({ platform: 'discord', tenantId: '' }),
    );
  });

  it('refuses an identity already linked to another LobeHub account', async () => {
    mocks.peekBindSession.mockResolvedValue(pendingSession('slack'));
    mocks.findByPlatformUser.mockResolvedValue({ userId: 'user-bob' });

    const result = await completeOAuthBind({
      install: install(),
      platform: 'slack',
      pollId: 'poll-1',
      serverDB,
      userId: 'user-alice',
    });

    expect(result).toEqual({ reason: 'already_linked_to_other', status: 'failed' });
    expect(mocks.upsertForPlatform).not.toHaveBeenCalled();
    expect(mocks.greetAfterBind).not.toHaveBeenCalled();
  });

  it('fails cleanly when the platform did not reveal who installed it', async () => {
    mocks.peekBindSession.mockResolvedValue(pendingSession('discord'));

    const result = await completeOAuthBind({
      install: install({ installedByPlatformUserId: null }),
      platform: 'discord',
      pollId: 'poll-1',
      serverDB,
      userId: 'user-alice',
    });

    expect(result).toEqual({ reason: 'identity_unavailable', status: 'failed' });
    expect(mocks.settleBindSession).toHaveBeenCalledWith('poll-1', result);
  });

  it('refuses a consent finished after the bind expired', async () => {
    mocks.peekBindSession.mockResolvedValue({ ...pendingSession('slack'), createdAt: -1 });

    await expect(
      completeOAuthBind({
        install: install(),
        platform: 'slack',
        pollId: 'poll-1',
        serverDB,
        userId: 'user-alice',
      }),
    ).resolves.toEqual({ status: 'expired' });
    expect(mocks.upsertForPlatform).not.toHaveBeenCalled();
    expect(mocks.greetAfterBind).not.toHaveBeenCalled();
  });

  it('ignores a session for another platform or one already settled', async () => {
    mocks.peekBindSession.mockResolvedValue(pendingSession('discord'));

    await expect(
      completeOAuthBind({
        install: install(),
        platform: 'slack',
        pollId: 'poll-1',
        serverDB,
        userId: 'user-alice',
      }),
    ).resolves.toEqual({ status: 'expired' });
    expect(mocks.upsertForPlatform).not.toHaveBeenCalled();
  });
});

describe('failOAuthBind', () => {
  it('settles the pending session as oauth_failed', async () => {
    mocks.peekBindSession.mockResolvedValue(pendingSession('slack'));

    await failOAuthBind({ platform: 'slack', pollId: 'poll-1', userId: 'user-alice' });

    expect(mocks.peekBindSession).toHaveBeenCalledWith('poll-1', 'user-alice');
    expect(mocks.settleBindSession).toHaveBeenCalledWith('poll-1', {
      reason: 'oauth_failed',
      status: 'failed',
    });
  });

  it('leaves an already settled or foreign session alone', async () => {
    mocks.peekBindSession.mockResolvedValue({
      ...pendingSession('slack'),
      result: { linkedAt: 1, platformUserId: 'U', status: 'linked' },
    });
    await failOAuthBind({ platform: 'slack', pollId: 'poll-1', userId: 'user-alice' });

    mocks.peekBindSession.mockResolvedValue(null);
    await failOAuthBind({ platform: 'slack', pollId: 'poll-1', userId: 'user-bob' });

    expect(mocks.settleBindSession).not.toHaveBeenCalled();
  });
});

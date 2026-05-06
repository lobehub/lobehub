// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SlackApi } from '@/server/services/bot/platforms/slack/api';

import { issueLinkToken } from '../../linkTokenStore';
import { MessengerSlackBinder } from './binder';

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com' },
}));

vi.mock('../../linkTokenStore', () => ({
  issueLinkToken: vi.fn(),
}));

vi.mock('@/server/services/bot/platforms/slack/api', () => ({
  SlackApi: vi.fn(),
}));

vi.mock('@/server/services/bot/platforms/slack/client', () => ({
  SlackClientFactory: vi.fn(),
}));

vi.mock('../../installations', () => ({
  getInstallationStore: vi.fn(),
}));

const slackCreds = (overrides: any = {}) => ({
  applicationId: 'A_APP',
  botToken: 'xoxb-acme',
  installationKey: 'slack:T_ACME',
  metadata: { tenantName: 'Acme Inc' },
  platform: 'slack' as const,
  signingSecret: 'sigsec',
  tenantId: 'T_ACME',
  ...overrides,
});

let postMessageWithButtonAndLink: ReturnType<typeof vi.fn>;
let postMessage: ReturnType<typeof vi.fn>;
let getUserInfo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  postMessageWithButtonAndLink = vi.fn().mockResolvedValue({ ts: '1' });
  postMessage = vi.fn().mockResolvedValue({ ts: '1' });
  getUserInfo = vi.fn().mockResolvedValue({ profile: { email: 'alice@acme.com' } });

  vi.mocked(SlackApi).mockImplementation(
    () =>
      ({
        getUserInfo,
        postMessage,
        postMessageWithButtonAndLink,
      }) as any,
  );

  vi.mocked(issueLinkToken).mockResolvedValue('rand-token-1');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MessengerSlackBinder.handleUnlinkedMessage', () => {
  it('issues a link token with tenant scope and posts the button+link DM', async () => {
    const binder = new MessengerSlackBinder(slackCreds());
    await binder.handleUnlinkedMessage({
      authorUserId: 'U_ALICE',
      authorUserName: 'alice',
      chatId: 'D_DM',
      message: { id: 'm1', text: 'hi' } as any,
    });

    expect(issueLinkToken).toHaveBeenCalledWith({
      platform: 'slack',
      platformUserId: 'U_ALICE',
      platformUsername: 'alice',
      tenantId: 'T_ACME',
      tenantName: 'Acme Inc',
    });

    expect(postMessageWithButtonAndLink).toHaveBeenCalledTimes(1);
    const [channel, intro, button, linkLabel] = postMessageWithButtonAndLink.mock.calls[0];
    expect(channel).toBe('D_DM');
    expect(intro).toContain("I'm LobeHub");
    expect(button.text).toContain('Link Account');
    // Button URL and inline link URL must match exactly so the user can pick
    // either path. Both carry the full Slack context as URL params.
    expect(button.url).toBe(linkLabel.match(/<([^|>]+)\|/)?.[1]);
    expect(button.url).toContain('im_type=slack');
    expect(button.url).toContain('random_id=rand-token-1');
    expect(button.url).toContain('slack_user_id=U_ALICE');
    expect(button.url).toContain('slack_team_id=T_ACME');
    expect(button.url).toContain('slack_user_email=alice%40acme.com');
    expect(button.url).toContain('channel=D_DM');
  });

  it('uses chat.postMessage (NOT chat.postEphemeral) so the prompt stays in DM history', async () => {
    const binder = new MessengerSlackBinder(slackCreds());
    await binder.handleUnlinkedMessage({
      authorUserId: 'U_ALICE',
      chatId: 'D_DM',
      message: { id: 'm1' } as any,
    });
    // postEphemeral isn't called — only the button+link in-history post.
    const apiInstance = vi.mocked(SlackApi).mock.results[0]?.value as any;
    expect(apiInstance?.postEphemeral).toBeUndefined();
    expect(postMessageWithButtonAndLink).toHaveBeenCalled();
  });

  it('falls back to empty email when getUserInfo fails (verify-im handles missing email)', async () => {
    getUserInfo.mockRejectedValueOnce(new Error('insufficient_scope'));

    const binder = new MessengerSlackBinder(slackCreds());
    await binder.handleUnlinkedMessage({
      authorUserId: 'U_ALICE',
      chatId: 'D_DM',
      message: { id: 'm1' } as any,
    });

    const [, , button] = postMessageWithButtonAndLink.mock.calls[0];
    expect(button.url).not.toContain('slack_user_email=');
  });

  it('apologises and bails when issueLinkToken throws (Redis down)', async () => {
    vi.mocked(issueLinkToken).mockRejectedValueOnce(new Error('redis offline'));

    const binder = new MessengerSlackBinder(slackCreds());
    await binder.handleUnlinkedMessage({
      authorUserId: 'U_ALICE',
      chatId: 'D_DM',
      message: { id: 'm1' } as any,
    });

    expect(postMessage).toHaveBeenCalledWith(
      'D_DM',
      expect.stringContaining('temporarily unavailable'),
    );
    expect(postMessageWithButtonAndLink).not.toHaveBeenCalled();
  });

  it('no-ops when constructed without creds (legacy fallback path)', async () => {
    const binder = new MessengerSlackBinder();
    await binder.handleUnlinkedMessage({
      authorUserId: 'U_ALICE',
      chatId: 'D_DM',
      message: { id: 'm1' } as any,
    });
    expect(issueLinkToken).not.toHaveBeenCalled();
    expect(postMessageWithButtonAndLink).not.toHaveBeenCalled();
  });
});

describe('MessengerSlackBinder.notifyLinkSuccess', () => {
  it('uses injected creds to send the success DM', async () => {
    const binder = new MessengerSlackBinder(slackCreds());
    await binder.notifyLinkSuccess({
      activeAgentName: 'My Assistant',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
    });
    expect(postMessage).toHaveBeenCalledWith(
      'U_ALICE',
      expect.stringContaining('Linked successfully'),
    );
    expect(postMessage.mock.calls[0][1]).toContain('My Assistant');
  });

  it('lazily resolves creds via the installation store when constructed without them', async () => {
    const { getInstallationStore } = await import('../../installations');
    const resolveByKey = vi.fn().mockResolvedValue(slackCreds());
    vi.mocked(getInstallationStore).mockReturnValue({
      markRevoked: vi.fn(),
      resolveByKey,
      resolveByPayload: vi.fn(),
    });

    const binder = new MessengerSlackBinder();
    await binder.notifyLinkSuccess({ platformUserId: 'U_ALICE', tenantId: 'T_ACME' });

    expect(resolveByKey).toHaveBeenCalledWith('slack:T_ACME');
    expect(postMessage).toHaveBeenCalled();
  });

  it('skips when neither creds nor tenantId are available', async () => {
    const binder = new MessengerSlackBinder();
    await binder.notifyLinkSuccess({ platformUserId: 'U_ALICE' });
    expect(postMessage).not.toHaveBeenCalled();
  });
});

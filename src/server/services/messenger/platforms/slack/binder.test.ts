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
let postEphemeral: ReturnType<typeof vi.fn>;
let postMessageWithButtonGrid: ReturnType<typeof vi.fn>;
let postEphemeralWithButtonGrid: ReturnType<typeof vi.fn>;
let updateMessageWithButtonGrid: ReturnType<typeof vi.fn>;
let updateEphemeralButtonGrid: ReturnType<typeof vi.fn>;
let getUserInfo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  postMessageWithButtonAndLink = vi.fn().mockResolvedValue({ ts: '1' });
  postMessage = vi.fn().mockResolvedValue({ ts: '1' });
  postEphemeral = vi.fn().mockResolvedValue(undefined);
  postMessageWithButtonGrid = vi.fn().mockResolvedValue({ ts: '1' });
  postEphemeralWithButtonGrid = vi.fn().mockResolvedValue(undefined);
  updateMessageWithButtonGrid = vi.fn().mockResolvedValue(undefined);
  updateEphemeralButtonGrid = vi.fn().mockResolvedValue(undefined);
  getUserInfo = vi.fn().mockResolvedValue({ profile: { email: 'alice@acme.com' } });

  vi.mocked(SlackApi).mockImplementation(
    () =>
      ({
        getUserInfo,
        postEphemeral,
        postEphemeralWithButtonGrid,
        postMessage,
        postMessageWithButtonAndLink,
        postMessageWithButtonGrid,
        updateEphemeralButtonGrid,
        updateMessageWithButtonGrid,
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
    expect(postEphemeral).not.toHaveBeenCalled();
    expect(postMessageWithButtonAndLink).toHaveBeenCalled();
  });

  it('posts an ephemeral anchored in the mention thread for an unlinked channel mention', async () => {
    const binder = new MessengerSlackBinder(slackCreds());
    await binder.handleUnlinkedMessage({
      authorUserId: 'U_ALICE',
      authorUserName: 'alice',
      // Router passes the bare channel id as `chatId` and the raw chat-sdk
      // thread.id as `channelMentionThreadId` (slack: `slack:CHAN:TS`).
      channelMentionThreadId: 'slack:C_GENERAL:1715000000.000100',
      chatId: 'C_GENERAL',
      message: { id: 'm1', text: 'hi' } as any,
    });

    // Ephemeral path — the in-history button post must NOT fire (otherwise
    // the verify-im URL would leak to the channel).
    expect(postMessageWithButtonAndLink).not.toHaveBeenCalled();
    expect(postEphemeral).toHaveBeenCalledTimes(1);
    const [channel, user, text, options] = postEphemeral.mock.calls[0];
    expect(channel).toBe('C_GENERAL');
    expect(user).toBe('U_ALICE');
    expect(text).toContain("I'm LobeHub");
    // The verify-im URL is rendered as a Slack mrkdwn `<url|label>` link.
    expect(text).toMatch(/<https?:\/\/[^|]+\|[^>]+>/);
    expect(text).toContain('random_id=rand-token-1');
    expect(text).toContain('slack_user_id=U_ALICE');
    // Anchored in the mention thread so the prompt sits next to the mention.
    expect(options).toEqual({ threadTs: '1715000000.000100' });
  });

  it('falls back to ephemeral error when issueLinkToken fails on a channel mention', async () => {
    vi.mocked(issueLinkToken).mockRejectedValueOnce(new Error('redis offline'));

    const binder = new MessengerSlackBinder(slackCreds());
    await binder.handleUnlinkedMessage({
      authorUserId: 'U_ALICE',
      channelMentionThreadId: 'slack:C_GENERAL:1715000000.000100',
      chatId: 'C_GENERAL',
      message: { id: 'm1' } as any,
    });

    expect(postEphemeral).toHaveBeenCalledWith(
      'C_GENERAL',
      'U_ALICE',
      expect.stringContaining('temporarily unavailable'),
      { threadTs: '1715000000.000100' },
    );
    expect(postMessage).not.toHaveBeenCalled();
    expect(postMessageWithButtonAndLink).not.toHaveBeenCalled();
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

describe('MessengerSlackBinder.sendAgentPicker', () => {
  it('posts a public picker (chat.postMessage) when ephemeralTo is omitted', async () => {
    const binder = new MessengerSlackBinder(slackCreds());
    await binder.sendAgentPicker('D_DM', {
      entries: [
        { id: 'agt_a', isActive: true, title: 'A' },
        { id: 'agt_b', isActive: false, title: 'B' },
      ],
      text: 'pick',
    });
    expect(postMessageWithButtonGrid).toHaveBeenCalledTimes(1);
    expect(postEphemeralWithButtonGrid).not.toHaveBeenCalled();
  });

  it('posts an ephemeral picker (chat.postEphemeral) when ephemeralTo is set', async () => {
    const binder = new MessengerSlackBinder(slackCreds());
    await binder.sendAgentPicker('C_GENERAL', {
      entries: [{ id: 'agt_a', isActive: true, title: 'A' }],
      ephemeralTo: 'U_ALICE',
      text: 'pick',
    });
    // The public path must NOT fire — otherwise the picker would broadcast.
    expect(postMessageWithButtonGrid).not.toHaveBeenCalled();
    expect(postEphemeralWithButtonGrid).toHaveBeenCalledTimes(1);
    const [channel, user, text, buttons] = postEphemeralWithButtonGrid.mock.calls[0];
    expect(channel).toBe('C_GENERAL');
    expect(user).toBe('U_ALICE');
    expect(text).toBe('pick');
    expect(buttons).toHaveLength(1);
  });
});

describe('MessengerSlackBinder.acknowledgeCallback', () => {
  it('updates the picker via response_url when callbackId is set (works for ephemerals)', async () => {
    const binder = new MessengerSlackBinder(slackCreds());
    await binder.acknowledgeCallback(
      {
        callbackId: 'https://hooks.slack.com/actions/T/abc',
        chatId: 'C_GENERAL',
        data: 'messenger:switch:agt_b',
        fromUserId: 'U_ALICE',
        // Ephemeral pickers have no permanent ts.
        messageId: undefined,
      },
      {
        toast: 'Switched to B',
        updatedPicker: {
          entries: [
            { id: 'agt_a', isActive: false, title: 'A' },
            { id: 'agt_b', isActive: true, title: 'B' },
          ],
          text: 'Tap an agent to make it the active one:',
        },
      },
    );
    expect(updateEphemeralButtonGrid).toHaveBeenCalledTimes(1);
    const [responseUrl, , buttons] = updateEphemeralButtonGrid.mock.calls[0];
    expect(responseUrl).toBe('https://hooks.slack.com/actions/T/abc');
    // Active marker now on agt_b (✅ prefix).
    expect(buttons.find((b: any) => b.value === 'agt_b').text).toContain('✅');
    // chat.update path must NOT fire — would silently fail on ephemerals.
    expect(updateMessageWithButtonGrid).not.toHaveBeenCalled();
    // Toast still shown as a separate ephemeral.
    expect(postEphemeral).toHaveBeenCalledWith('C_GENERAL', 'U_ALICE', 'Switched to B');
  });

  it('falls back to chat.update only when response_url is unavailable', async () => {
    const binder = new MessengerSlackBinder(slackCreds());
    await binder.acknowledgeCallback(
      {
        callbackId: '',
        chatId: 'D_DM',
        data: 'messenger:switch:agt_b',
        fromUserId: 'U_ALICE',
        messageId: '1715000000.000200',
      },
      {
        updatedPicker: {
          entries: [{ id: 'agt_b', isActive: true, title: 'B' }],
          text: 'Tap an agent to make it the active one:',
        },
      },
    );
    expect(updateEphemeralButtonGrid).not.toHaveBeenCalled();
    expect(updateMessageWithButtonGrid).toHaveBeenCalledWith(
      'D_DM',
      '1715000000.000200',
      'Tap an agent to make it the active one:',
      expect.any(Array),
    );
  });
});

describe('MessengerSlackBinder.replyEphemeral', () => {
  it('forwards channelId/userId/text/threadTs to chat.postEphemeral', async () => {
    const binder = new MessengerSlackBinder(slackCreds());
    await binder.replyEphemeral({
      channelId: 'C_GENERAL',
      text: 'just for you',
      threadTs: '1715000000.000100',
      userId: 'U_ALICE',
    });
    expect(postEphemeral).toHaveBeenCalledWith('C_GENERAL', 'U_ALICE', 'just for you', {
      threadTs: '1715000000.000100',
    });
  });

  it('omits threadTs when caller did not supply one', async () => {
    const binder = new MessengerSlackBinder(slackCreds());
    await binder.replyEphemeral({
      channelId: 'C_GENERAL',
      text: 'just for you',
      userId: 'U_ALICE',
    });
    expect(postEphemeral).toHaveBeenCalledWith('C_GENERAL', 'U_ALICE', 'just for you', {
      threadTs: undefined,
    });
  });

  it('no-ops without creds', async () => {
    const binder = new MessengerSlackBinder();
    await binder.replyEphemeral({ channelId: 'C', text: 't', userId: 'U' });
    expect(postEphemeral).not.toHaveBeenCalled();
  });
});

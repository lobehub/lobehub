import { describe, expect, it } from 'vitest';

import { connectStepIndex, getInlineFieldKeys, getSetupGuide } from './guides';
import {
  buildDiscordInviteUrl,
  buildSlackCreateAppUrl,
  buildSlackManifest,
  DISCORD_BOT_PERMISSIONS,
  MAX_TRANSIENT_POLL_FAILURES,
  REGISTRATION_NAME_MAX_LENGTH,
  registrationPollInterval,
  scanCopyKey,
  tolerateTransientPollFailure,
  toRegistrationName,
} from './links';

describe('quick setup links', () => {
  it('grants the bot exactly the Discord permissions it needs', () => {
    // View Channel, Send Messages, Embed Links, Attach Files, Read History,
    // Add Reactions, Create Public Threads, Send Messages in Threads.
    const expected =
      (1n << 10n) |
      (1n << 11n) |
      (1n << 14n) |
      (1n << 15n) |
      (1n << 16n) |
      (1n << 6n) |
      (1n << 35n) |
      (1n << 38n);
    expect(DISCORD_BOT_PERMISSIONS).toBe(expected.toString());

    const url = new URL(buildDiscordInviteUrl('123'));
    expect(url.searchParams.get('client_id')).toBe('123');
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
  });

  it('builds a Socket Mode Slack manifest with a valid bot user name', () => {
    const manifest = buildSlackManifest({ name: '团队助手 Moss' });

    expect(manifest.settings.socket_mode_enabled).toBe(true);
    expect(manifest.settings.event_subscriptions.bot_events).toContain('app_mention');
    expect(manifest.oauth_config.scopes.bot).toContain('chat:write');
    // Group DMs, as in the Slack setup guide.
    expect(manifest.settings.event_subscriptions.bot_events).toContain('message.mpim');
    expect(manifest.oauth_config.scopes.bot).toContain('mpim:read');
    // Attachment uploads and the /new and /stop commands.
    expect(manifest.oauth_config.scopes.bot).toEqual(
      expect.arrayContaining(['files:write', 'commands']),
    );
    expect(manifest.features.slash_commands.map(({ command }) => command)).toEqual([
      '/new',
      '/stop',
    ]);
    expect(manifest.features.bot_user.display_name).toBe('moss');
    expect(buildSlackManifest({ name: '助手' }).features.bot_user.display_name).toBe(
      'lobehub-assistant',
    );

    const url = new URL(buildSlackCreateAppUrl({ name: 'Moss' }));
    expect(url.searchParams.get('new_app')).toBe('1');
    expect(JSON.parse(url.searchParams.get('manifest_json')!).display_information.name).toBe(
      'Moss',
    );
  });
});

describe('toRegistrationName', () => {
  it('cuts a long agent name to the registration limit without splitting a character', () => {
    expect(toRegistrationName('Moss')).toBe('Moss');

    const long = 'a'.repeat(REGISTRATION_NAME_MAX_LENGTH + 10);
    expect(toRegistrationName(long)).toHaveLength(REGISTRATION_NAME_MAX_LENGTH);

    // An emoji is two UTF-16 units; one that would cross the limit is dropped whole.
    const name = toRegistrationName(`${'a'.repeat(REGISTRATION_NAME_MAX_LENGTH - 1)}🤖`);
    expect(name).toBe('a'.repeat(REGISTRATION_NAME_MAX_LENGTH - 1));
  });
});

describe('registrationPollInterval', () => {
  it('keeps every slow_down increase for all later polls', () => {
    expect(registrationPollInterval(5, 0)).toBe(5000);
    expect(registrationPollInterval(5, 1)).toBe(10_000);
    expect(registrationPollInterval(5, 2)).toBe(15_000);
    expect(registrationPollInterval(undefined, 0)).toBe(5000);
  });
});

describe('tolerateTransientPollFailure', () => {
  it('keeps polling through failed requests and gives up only after several in a row', async () => {
    const failures = { current: 0 };
    const pending = { status: 'pending' };
    const fail = () => Promise.reject(new Error('502'));

    await expect(tolerateTransientPollFailure(fail, failures, pending)).resolves.toBe(pending);
    // A good answer resets the count.
    await expect(
      tolerateTransientPollFailure(async () => 'success', failures, pending),
    ).resolves.toBe('success');
    expect(failures.current).toBe(0);

    for (let i = 1; i < MAX_TRANSIENT_POLL_FAILURES; i++)
      await expect(tolerateTransientPollFailure(fail, failures, pending)).resolves.toBe(pending);
    await expect(tolerateTransientPollFailure(fail, failures, pending)).rejects.toThrow('502');
  });
});

describe('scanCopyKey', () => {
  it('names Lark in the copy of a Lark scan', () => {
    expect(scanCopyKey('lark', 'waiting')).toBe('channel.quickSetup.feishu.scan.lark.waiting');
    expect(scanCopyKey('feishu', 'waiting')).toBe('channel.quickSetup.feishu.scan.waiting');
  });
});

describe('getSetupGuide', () => {
  it('starts LINE from an Official Account and ends with the manual webhook', () => {
    const guide = getSetupGuide('line', { appName: 'Moss' })!;
    expect(guide.steps.map(({ key }) => key)).toEqual([
      'account',
      'messagingApi',
      'credentials',
      'webhook',
    ]);
    // LINE no longer creates Messaging API channels in the Developers Console.
    expect(guide.steps[0].link?.href).toContain('entry.line.biz');
  });

  it('offers scan-to-create for Feishu and Lark with their own consoles', () => {
    const feishu = getSetupGuide('feishu', { appName: 'Moss' })!;
    const lark = getSetupGuide('lark', { appName: 'Moss' })!;

    expect(feishu.scanToCreate).toBe(true);
    expect(feishu.steps[0].link?.href).toContain('open.feishu.cn');
    expect(lark.steps[0].link?.href).toContain('open.larksuite.com');
  });

  it('unlocks the Discord invite once the application ID is known', () => {
    const before = getSetupGuide('discord', { appName: 'Moss' })!;
    const after = getSetupGuide('discord', { applicationId: ' 42 ', appName: 'Moss' })!;
    const invite = (guide: typeof before) => guide.steps.find((step) => step.key === 'invite')!;

    expect(invite(before)).toMatchObject({ link: undefined, needsApplicationId: true });
    expect(invite(after).link?.href).toContain('client_id=42');
    expect(after.steps.find((step) => step.key === 'bot')!.link?.href).toContain('/42/bot');
  });

  it('links Slack steps into the app once its ID is known', () => {
    const guide = getSetupGuide('slack', { applicationId: 'A1', appName: 'Moss' })!;

    expect(guide.steps[0].link?.href).toContain('manifest_json');
    expect(guide.steps[1].link?.href).toBe('https://api.slack.com/apps/A1/oauth');
  });

  it('has no guide for platforms with their own flow', () => {
    expect(getSetupGuide('wechat', { appName: 'Moss' })).toBeUndefined();
  });

  it('asks for each credential in the step that produces it', () => {
    const guide = getSetupGuide('discord', { appName: 'Moss' })!;
    const fieldsOf = (key: string) => guide.steps.find((step) => step.key === key)?.fields;

    expect(fieldsOf('credentials')).toEqual(['applicationId', 'publicKey']);
    expect(fieldsOf('bot')).toEqual(['botToken']);
  });

  it('never asks for one credential in two steps', () => {
    for (const platform of ['discord', 'slack', 'telegram', 'qq', 'line', 'feishu', 'lark']) {
      const guide = getSetupGuide(platform, { appName: 'Moss' })!;
      const keys = guide.steps.flatMap((step) => step.fields ?? []);

      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('lists the inline credentials per platform, and none for a platform without a guide', () => {
    expect([...getInlineFieldKeys('telegram')]).toEqual(['botToken']);
    expect(getInlineFieldKeys('wechat').size).toBe(0);
  });

  it('asks to save right after the last step with a credential, before what needs a running bot', () => {
    const at = (platform: string) => {
      const steps = getSetupGuide(platform, { appName: 'Moss' })!.steps;
      return steps.map((step) => step.key).toSpliced(connectStepIndex(steps), 0, 'connect');
    };

    expect(at('discord')).toEqual(['create', 'credentials', 'bot', 'connect', 'invite']);
    expect(at('telegram')).toEqual(['botfather', 'token', 'connect', 'privacy']);
    expect(at('line')).toEqual(['account', 'messagingApi', 'credentials', 'connect', 'webhook']);
    expect(connectStepIndex([{ key: 'only' }])).toBe(1);
  });
});

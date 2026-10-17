import { describe, expect, it } from 'vitest';

import { getSetupGuide } from './guides';
import {
  buildDiscordInviteUrl,
  buildSlackCreateAppUrl,
  buildSlackManifest,
  DISCORD_BOT_PERMISSIONS,
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

describe('getSetupGuide', () => {
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
});

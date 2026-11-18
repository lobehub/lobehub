import { describe, expect, it } from 'vitest';

import {
  agentAccountSettingsSchema,
  DEFAULT_DIGEST_MINUTES,
  isWakeSender,
  resolveWakeConfig,
} from './config';

describe('resolveWakeConfig', () => {
  it('defaults to on with an hourly digest and no listed senders', () => {
    expect(resolveWakeConfig(undefined)).toEqual({
      digestMs: DEFAULT_DIGEST_MINUTES * 60_000,
      mode: 'on',
      wakeSenders: [],
    });
  });

  it('falls back field by field on stored values this build does not accept', () => {
    const config = resolveWakeConfig({
      wake: {
        digestMinutes: 1.5,
        mode: 'loud' as any,
        wakeSenders: ['CEO@LobeHub.com', 'not-an-address', 42 as any, '@Team.io'],
      },
    });

    expect(config).toEqual({
      digestMs: DEFAULT_DIGEST_MINUTES * 60_000,
      mode: 'on',
      wakeSenders: ['ceo@lobehub.com', '@team.io'],
    });
  });

  it('clamps the digest window into its range', () => {
    expect(resolveWakeConfig({ wake: { digestMinutes: 1 } }).digestMs).toBe(5 * 60_000);
    expect(resolveWakeConfig({ wake: { digestMinutes: 99_999 } }).digestMs).toBe(1440 * 60_000);
  });
});

describe('isWakeSender', () => {
  const senders = ['ceo@lobehub.com', '@team.io'];

  it('matches a full address or a whole domain, ignoring case', () => {
    expect(isWakeSender('CEO@lobehub.com', senders)).toBe(true);
    expect(isWakeSender('anyone@team.io', senders)).toBe(true);
  });

  it('does not match a look-alike domain or another address at the same domain', () => {
    expect(isWakeSender('anyone@evilteam.io', senders)).toBe(false);
    expect(isWakeSender('anyone@team.io.evil.com', senders)).toBe(false);
    expect(isWakeSender('cfo@lobehub.com', senders)).toBe(false);
  });
});

describe('agentAccountSettingsSchema', () => {
  it('accepts and normalizes a valid write', () => {
    expect(
      agentAccountSettingsSchema.parse({
        wake: {
          digestMinutes: 30,
          mode: 'on',
          wakeSenders: [' CEO@lobehub.com ', '@team.io'],
        },
      }),
    ).toEqual({
      wake: { digestMinutes: 30, mode: 'on', wakeSenders: ['ceo@lobehub.com', '@team.io'] },
    });
  });

  it('refuses unknown modes, bad senders, out-of-range windows and unknown keys', () => {
    expect(agentAccountSettingsSchema.safeParse({ wake: { mode: 'loud' } }).success).toBe(false);
    expect(
      agentAccountSettingsSchema.safeParse({ wake: { wakeSenders: ['nobody'] } }).success,
    ).toBe(false);
    expect(agentAccountSettingsSchema.safeParse({ wake: { digestMinutes: 1 } }).success).toBe(
      false,
    );
    expect(agentAccountSettingsSchema.safeParse({ other: true }).success).toBe(false);
  });
});

// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { MessengerPlatformRegistry } from './registry';

const buildDefinition = (overrides: Partial<any> = {}) => ({
  connectionMode: 'webhook' as const,
  createBinder: vi.fn(() => ({ id: 'binder' }) as any),
  id: 'slack' as const,
  name: 'Slack',
  oauth: { exchangeCode: vi.fn() },
  webhookGate: { preprocess: vi.fn() },
  ...overrides,
});

describe('MessengerPlatformRegistry', () => {
  it('register / getPlatform round-trips a definition', () => {
    const reg = new MessengerPlatformRegistry();
    const def = buildDefinition() as any;
    expect(reg.register(def)).toBe(reg);
    expect(reg.getPlatform('slack')).toBe(def);
  });

  it('throws when registering a duplicate platform id', () => {
    const reg = new MessengerPlatformRegistry();
    reg.register(buildDefinition() as any);
    expect(() => reg.register(buildDefinition() as any)).toThrow(/already registered/);
  });

  it('listPlatforms returns every registered definition', () => {
    const reg = new MessengerPlatformRegistry();
    reg.register(buildDefinition({ id: 'slack', name: 'Slack' }) as any);
    reg.register(buildDefinition({ id: 'telegram', name: 'Telegram' }) as any);
    expect(reg.listPlatforms().map((d) => d.id)).toEqual(['slack', 'telegram']);
  });

  it('listSerializedPlatforms strips runtime-only fields (createBinder, oauth, webhookGate)', () => {
    const reg = new MessengerPlatformRegistry();
    reg.register(buildDefinition() as any);
    const [serialized] = reg.listSerializedPlatforms();
    expect(serialized).toEqual({ connectionMode: 'webhook', id: 'slack', name: 'Slack' });
    expect((serialized as any).createBinder).toBeUndefined();
    expect((serialized as any).oauth).toBeUndefined();
    expect((serialized as any).webhookGate).toBeUndefined();
  });

  it('createBinder dispatches to the registered factory with the credentials', () => {
    const reg = new MessengerPlatformRegistry();
    const factory = vi.fn(() => ({ kind: 'binder' }) as any);
    reg.register(buildDefinition({ createBinder: factory }) as any);
    const creds = {
      applicationId: 'A',
      botToken: 'b',
      installationKey: 'slack:T',
      metadata: {},
      platform: 'slack' as const,
      tenantId: 'T',
    };
    const binder = reg.createBinder(creds);
    expect(factory).toHaveBeenCalledWith(creds);
    expect(binder).toEqual({ kind: 'binder' });
  });

  it('createBinder returns null for unknown platforms', () => {
    const reg = new MessengerPlatformRegistry();
    const binder = reg.createBinder({
      applicationId: 'A',
      botToken: 'b',
      installationKey: 'unknown:x',
      metadata: {},
      platform: 'discord' as any,
      tenantId: 'x',
    });
    expect(binder).toBeNull();
  });
});

describe('messengerPlatformRegistry singleton', () => {
  it('registers slack, telegram, and discord on import', async () => {
    const { messengerPlatformRegistry } = await import('./index');
    const ids = messengerPlatformRegistry.listPlatforms().map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['slack', 'telegram', 'discord']));
  });
});

import { describe, expect, it, vi } from 'vitest';

import { PlatformRegistry } from './registry';
import { buildRuntimeKey, parseRuntimeKey } from './utils';

describe('PlatformRegistry', () => {
  const fakeFactory = (overrides?: any) => ({
    createClient: vi.fn(),
    validateCredentials: vi.fn().mockResolvedValue({ valid: true }),
    validateSettings: vi.fn().mockResolvedValue({ valid: true }),
    ...overrides,
  });

  const fakeDef = (id: string, overrides?: any) =>
    ({
      clientFactory: fakeFactory(overrides?.clientFactory),
      ...overrides,
      id,
    }) as any;

  describe('register / getPlatform', () => {
    it('should register and retrieve a platform definition', () => {
      const registry = new PlatformRegistry();
      const def = fakeDef('test');

      registry.register(def);

      expect(registry.getPlatform('test')).toBe(def);
    });

    it('should throw on duplicate registration', () => {
      const registry = new PlatformRegistry();
      registry.register(fakeDef('test'));

      expect(() => registry.register(fakeDef('test'))).toThrow('already registered');
    });

    it('should return undefined for unknown platform', () => {
      const registry = new PlatformRegistry();
      expect(registry.getPlatform('unknown')).toBeUndefined();
    });
  });

  describe('listPlatforms', () => {
    it('should list all registered definitions', () => {
      const registry = new PlatformRegistry();
      const a = fakeDef('a');
      const b = fakeDef('b');

      registry.register(a).register(b);

      expect(registry.listPlatforms()).toEqual([a, b]);
    });
  });

  describe('createClient', () => {
    it('should delegate to definition.clientFactory.createClient', () => {
      const mockClient = { id: 'test' };
      const mockCreateClient = vi.fn().mockReturnValue(mockClient);
      const registry = new PlatformRegistry();
      registry.register(fakeDef('test', { clientFactory: { createClient: mockCreateClient } }));

      const config = { applicationId: 'app-1', credentials: {}, platform: 'test', settings: {} };
      const result = registry.createClient('test', config);

      expect(result).toBe(mockClient);
      expect(mockCreateClient).toHaveBeenCalledWith(config, {});
    });

    it('should throw for unknown platform', () => {
      const registry = new PlatformRegistry();
      const config = { applicationId: 'app-1', credentials: {}, platform: 'x', settings: {} };

      expect(() => registry.createClient('x', config)).toThrow('not registered');
    });
  });

  describe('validateCredentials', () => {
    it('should delegate to definition.clientFactory.validateCredentials', async () => {
      const mockValidate = vi.fn().mockResolvedValue({ valid: true });
      const registry = new PlatformRegistry();
      registry.register(fakeDef('test', { clientFactory: { validateCredentials: mockValidate } }));

      const result = await registry.validateCredentials('test', { token: 'abc' });

      expect(result).toEqual({ valid: true });
      expect(mockValidate).toHaveBeenCalledWith({ token: 'abc' }, undefined, undefined, 'test');
    });

    it('should return error for unknown platform', async () => {
      const registry = new PlatformRegistry();
      const result = await registry.validateCredentials('unknown', {});
      expect(result.valid).toBe(false);
    });
  });
});

describe('buildRuntimeKey', () => {
  it('should build a runtime key from entry and applicationId', () => {
    expect(buildRuntimeKey('telegram', 'bot-123')).toBe('telegram:bot-123');
  });
});

describe('parseRuntimeKey', () => {
  it('should parse a runtime key into components', () => {
    expect(parseRuntimeKey('discord:app-456')).toEqual({
      applicationId: 'app-456',
      platform: 'discord',
    });
  });

  it('should roundtrip with buildRuntimeKey', () => {
    const key = buildRuntimeKey('feishu', 'my-app');
    expect(parseRuntimeKey(key)).toEqual({
      applicationId: 'my-app',
      platform: 'feishu',
    });
  });
});

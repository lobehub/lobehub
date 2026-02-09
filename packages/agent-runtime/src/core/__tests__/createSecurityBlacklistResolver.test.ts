import { describe, expect, it } from 'vitest';

import { DEFAULT_SECURITY_BLACKLIST } from '../defaultSecurityBlacklist';
import {
  SECURITY_BLACKLIST_RESOLVER_TYPE,
  createSecurityBlacklistGlobalResolver,
  createSecurityBlacklistResolver,
} from '../createSecurityBlacklistResolver';

describe('createSecurityBlacklistResolver', () => {
  describe('createSecurityBlacklistResolver', () => {
    it('should return true for blacklisted commands using default blacklist', () => {
      const resolver = createSecurityBlacklistResolver();
      // "rm -rf /" matches the default blacklist
      expect(resolver({ command: 'rm -rf /' })).toBe(true);
    });

    it('should return false for safe commands using default blacklist', () => {
      const resolver = createSecurityBlacklistResolver();
      expect(resolver({ command: 'ls -la' })).toBe(false);
    });

    it('should use blacklist from metadata when provided', () => {
      const resolver = createSecurityBlacklistResolver();
      const customBlacklist = [
        {
          description: 'Block custom command',
          match: { command: { pattern: 'custom-danger.*', type: 'regex' as const } },
        },
      ];

      expect(resolver({ command: 'custom-danger --force' }, { securityBlacklist: customBlacklist })).toBe(true);
      // Default blacklist commands should not be blocked with custom blacklist
      expect(resolver({ command: 'rm -rf /' }, { securityBlacklist: customBlacklist })).toBe(false);
    });

    it('should fall back to DEFAULT_SECURITY_BLACKLIST when metadata has no blacklist', () => {
      const resolver = createSecurityBlacklistResolver();
      // No securityBlacklist in metadata → uses default
      expect(resolver({ command: 'rm -rf /' }, {})).toBe(true);
      expect(resolver({ command: 'rm -rf /' }, { otherField: 'value' })).toBe(true);
    });

    it('should fall back to DEFAULT_SECURITY_BLACKLIST when metadata is undefined', () => {
      const resolver = createSecurityBlacklistResolver();
      expect(resolver({ command: 'rm -rf /' }, undefined)).toBe(true);
    });

    it('should return false for empty tool args', () => {
      const resolver = createSecurityBlacklistResolver();
      expect(resolver({})).toBe(false);
    });

    it('should detect sensitive file paths via default blacklist', () => {
      const resolver = createSecurityBlacklistResolver();
      expect(resolver({ path: '/home/user/.env' })).toBe(true);
      expect(resolver({ path: '/home/user/.ssh/id_rsa' })).toBe(true);
    });

    it('should return false when metadata provides empty blacklist', () => {
      const resolver = createSecurityBlacklistResolver();
      expect(resolver({ command: 'rm -rf /' }, { securityBlacklist: [] })).toBe(false);
    });
  });

  describe('createSecurityBlacklistGlobalResolver', () => {
    it('should return a valid GlobalInterventionResolverConfig', () => {
      const config = createSecurityBlacklistGlobalResolver();

      expect(config.type).toBe(SECURITY_BLACKLIST_RESOLVER_TYPE);
      expect(config.policy).toBe('always');
      expect(typeof config.resolver).toBe('function');
    });

    it('should have a working resolver that blocks blacklisted commands', () => {
      const config = createSecurityBlacklistGlobalResolver();

      expect(config.resolver({ command: 'rm -rf /' })).toBe(true);
      expect(config.resolver({ command: 'ls -la' })).toBe(false);
    });
  });

  describe('SECURITY_BLACKLIST_RESOLVER_TYPE', () => {
    it('should be securityBlacklist', () => {
      expect(SECURITY_BLACKLIST_RESOLVER_TYPE).toBe('securityBlacklist');
    });
  });
});

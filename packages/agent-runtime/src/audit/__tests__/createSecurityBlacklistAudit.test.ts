import { describe, expect, it } from 'vitest';

import {
  createSecurityBlacklistAudit,
  createSecurityBlacklistGlobalAudit,
  SECURITY_BLACKLIST_AUDIT_TYPE,
} from '../createSecurityBlacklistAudit';

describe('createSecurityBlacklistAudit', () => {
  describe('createSecurityBlacklistAudit', () => {
    it('should return true for blacklisted commands using default blacklist', () => {
      const audit = createSecurityBlacklistAudit();
      // "rm -rf /" matches the default blacklist
      expect(audit({ command: 'rm -rf /' })).toBe(true);
    });

    it('should return false for safe commands using default blacklist', () => {
      const audit = createSecurityBlacklistAudit();
      expect(audit({ command: 'ls -la' })).toBe(false);
    });

    it('should use blacklist from metadata when provided', () => {
      const audit = createSecurityBlacklistAudit();
      const customBlacklist = [
        {
          description: 'Block custom command',
          match: { command: { pattern: 'custom-danger.*', type: 'regex' as const } },
        },
      ];

      expect(
        audit({ command: 'custom-danger --force' }, { securityBlacklist: customBlacklist }),
      ).toBe(true);
      // Default blacklist commands should not be blocked with custom blacklist
      expect(audit({ command: 'rm -rf /' }, { securityBlacklist: customBlacklist })).toBe(false);
    });

    it('should fall back to DEFAULT_SECURITY_BLACKLIST when metadata has no blacklist', () => {
      const audit = createSecurityBlacklistAudit();
      // No securityBlacklist in metadata → uses default
      expect(audit({ command: 'rm -rf /' }, {})).toBe(true);
      expect(audit({ command: 'rm -rf /' }, { otherField: 'value' })).toBe(true);
    });

    it('should fall back to DEFAULT_SECURITY_BLACKLIST when metadata is undefined', () => {
      const audit = createSecurityBlacklistAudit();
      expect(audit({ command: 'rm -rf /' }, undefined)).toBe(true);
    });

    it('should return false for empty tool args', () => {
      const audit = createSecurityBlacklistAudit();
      expect(audit({})).toBe(false);
    });

    it('should detect sensitive file paths via default blacklist', () => {
      const audit = createSecurityBlacklistAudit();
      expect(audit({ path: '/home/user/.env' })).toBe(true);
      expect(audit({ path: '/home/user/.ssh/id_rsa' })).toBe(true);
    });

    it('should return false when metadata provides empty blacklist', () => {
      const audit = createSecurityBlacklistAudit();
      expect(audit({ command: 'rm -rf /' }, { securityBlacklist: [] })).toBe(false);
    });
  });

  describe('createSecurityBlacklistGlobalAudit', () => {
    it('should return a valid GlobalInterventionAuditConfig', () => {
      const config = createSecurityBlacklistGlobalAudit();

      expect(config.type).toBe(SECURITY_BLACKLIST_AUDIT_TYPE);
      expect(config.policy).toBe('always');
      expect(typeof config.resolver).toBe('function');
    });

    it('should have a working resolver that blocks blacklisted commands', () => {
      const config = createSecurityBlacklistGlobalAudit();

      expect(config.resolver({ command: 'rm -rf /' })).toBe(true);
      expect(config.resolver({ command: 'ls -la' })).toBe(false);
    });
  });

  describe('SECURITY_BLACKLIST_AUDIT_TYPE', () => {
    it('should be securityBlacklist', () => {
      expect(SECURITY_BLACKLIST_AUDIT_TYPE).toBe('securityBlacklist');
    });
  });
});

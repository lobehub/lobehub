import { describe, expect, it } from 'vitest';

import {
  createSecurityBlacklistAudit,
  createSecurityBlacklistGlobalAudit,
  SECURITY_BLACKLIST_AUDIT_TYPE,
} from '../createSecurityBlacklistAudit';

describe('createSecurityBlacklistAudit', () => {
  describe('createSecurityBlacklistAudit', () => {
    it('should return true for blacklisted commands using default blacklist', async () => {
      const audit = createSecurityBlacklistAudit();
      await expect(audit({ command: 'rm -rf /' })).resolves.toBe(true);
    });

    it('should return false for safe commands using default blacklist', async () => {
      const audit = createSecurityBlacklistAudit();
      await expect(audit({ command: 'ls -la' })).resolves.toBe(false);
    });

    it('should use blacklist from metadata when provided', async () => {
      const audit = createSecurityBlacklistAudit();
      const customBlacklist = [
        {
          description: 'Block custom command',
          match: { command: { pattern: 'custom-danger.*', type: 'regex' as const } },
        },
      ];

      await expect(
        audit({ command: 'custom-danger --force' }, { securityBlacklist: customBlacklist }),
      ).resolves.toBe(true);
      await expect(
        audit({ command: 'rm -rf /' }, { securityBlacklist: customBlacklist }),
      ).resolves.toBe(false);
    });

    it('should fall back to DEFAULT_SECURITY_BLACKLIST when metadata has no blacklist', async () => {
      const audit = createSecurityBlacklistAudit();
      await expect(audit({ command: 'rm -rf /' }, {})).resolves.toBe(true);
      await expect(audit({ command: 'rm -rf /' }, { otherField: 'value' })).resolves.toBe(true);
    });

    it('should fall back to DEFAULT_SECURITY_BLACKLIST when metadata is undefined', async () => {
      const audit = createSecurityBlacklistAudit();
      await expect(audit({ command: 'rm -rf /' }, undefined)).resolves.toBe(true);
    });

    it('should return false for empty tool args', async () => {
      const audit = createSecurityBlacklistAudit();
      await expect(audit({})).resolves.toBe(false);
    });

    it('should detect sensitive file paths via default blacklist', async () => {
      const audit = createSecurityBlacklistAudit();
      await expect(audit({ path: '/home/user/.env' })).resolves.toBe(true);
      await expect(audit({ path: '/home/user/.ssh/id_rsa' })).resolves.toBe(true);
    });

    it('should return false when metadata provides empty blacklist', async () => {
      const audit = createSecurityBlacklistAudit();
      await expect(audit({ command: 'rm -rf /' }, { securityBlacklist: [] })).resolves.toBe(false);
    });
  });

  describe('createSecurityBlacklistGlobalAudit', () => {
    it('should return a valid GlobalInterventionAuditConfig', () => {
      const config = createSecurityBlacklistGlobalAudit();

      expect(config.type).toBe(SECURITY_BLACKLIST_AUDIT_TYPE);
      expect(config.policy).toBe('always');
      expect(typeof config.resolver).toBe('function');
    });

    it('should have a working resolver that blocks blacklisted commands', async () => {
      const config = createSecurityBlacklistGlobalAudit();

      await expect(config.resolver({ command: 'rm -rf /' })).resolves.toBe(true);
      await expect(config.resolver({ command: 'ls -la' })).resolves.toBe(false);
    });
  });

  describe('SECURITY_BLACKLIST_AUDIT_TYPE', () => {
    it('should be securityBlacklist', () => {
      expect(SECURITY_BLACKLIST_AUDIT_TYPE).toBe('securityBlacklist');
    });
  });
});

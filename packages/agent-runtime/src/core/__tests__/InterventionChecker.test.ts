import { type HumanInterventionConfig, type SecurityBlacklistConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { DEFAULT_SECURITY_BLACKLIST } from '../../audit/defaultSecurityBlacklist';
import { InterventionChecker } from '../InterventionChecker';

describe('InterventionChecker', () => {
  describe('shouldIntervene', () => {
    it('should return never when config is undefined', () => {
      const result = InterventionChecker.shouldIntervene({
        config: undefined,
        securityBlacklist: [], // Disable blacklist for this test
        toolArgs: {},
      });
      expect(result).toBe('never');
    });

    it('should return the policy when config is a simple string', () => {
      expect(
        InterventionChecker.shouldIntervene({
          config: 'never',
          securityBlacklist: [], // Disable blacklist for this test
          toolArgs: {},
        }),
      ).toBe('never');
      expect(
        InterventionChecker.shouldIntervene({
          config: 'required',
          securityBlacklist: [], // Disable blacklist for this test
          toolArgs: {},
        }),
      ).toBe('required');
    });

    it('should match rules in order and return first match', () => {
      const config: HumanInterventionConfig = [
        { match: { command: 'ls:*' }, policy: 'never' },
        { match: { command: 'git commit:*' }, policy: 'required' },
        { policy: 'required' }, // Default rule
      ];

      expect(
        InterventionChecker.shouldIntervene({
          config,
          securityBlacklist: [], // Disable blacklist for this test
          toolArgs: { command: 'ls:' },
        }),
      ).toBe('never');
      expect(
        InterventionChecker.shouldIntervene({
          config,
          securityBlacklist: [], // Disable blacklist for this test
          toolArgs: { command: 'git commit:' },
        }),
      ).toBe('required');
      expect(
        InterventionChecker.shouldIntervene({
          config,
          securityBlacklist: [], // Disable blacklist for this test
          toolArgs: { command: 'rm -rf /' },
        }),
      ).toBe('required');
    });

    it('should return require as default when no rule matches', () => {
      const config: HumanInterventionConfig = [{ match: { command: 'ls:*' }, policy: 'never' }];

      const result = InterventionChecker.shouldIntervene({
        config,
        securityBlacklist: [], // Disable blacklist for this test
        toolArgs: { command: 'rm -rf /' },
      });
      expect(result).toBe('required');
    });

    it('should handle multiple parameter matching', () => {
      const config: HumanInterventionConfig = [
        {
          match: {
            command: 'git add:*',
            path: '/Users/project/*',
          },
          policy: 'never',
        },
        { policy: 'required' },
      ];

      // Both match
      expect(
        InterventionChecker.shouldIntervene({
          config,
          securityBlacklist: [], // Disable blacklist for this test
          toolArgs: {
            command: 'git add:.',
            path: '/Users/project/file.ts',
          },
        }),
      ).toBe('never');

      // Only one matches
      expect(
        InterventionChecker.shouldIntervene({
          config,
          securityBlacklist: [], // Disable blacklist for this test
          toolArgs: {
            command: 'git add:.',
            path: '/tmp/file.ts',
          },
        }),
      ).toBe('required');
    });

    it('should handle default rule without match', () => {
      const config: HumanInterventionConfig = [
        { match: { command: 'ls:*' }, policy: 'never' },
        { policy: 'required' }, // Default rule
      ];

      const result = InterventionChecker.shouldIntervene({
        config,
        securityBlacklist: [], // Disable blacklist for this test
        toolArgs: { command: 'anything' },
      });
      expect(result).toBe('required');
    });
  });

  describe('matchPattern', () => {
    it('should match exact strings', () => {
      expect(InterventionChecker['matchPattern']('hello', 'hello')).toBe(true);
      expect(InterventionChecker['matchPattern']('hello', 'world')).toBe(false);
    });

    it('should match wildcard patterns', () => {
      expect(InterventionChecker['matchPattern']('*.ts', 'file.ts')).toBe(true);
      expect(InterventionChecker['matchPattern']('*.ts', 'file.js')).toBe(false);
      expect(InterventionChecker['matchPattern']('test*', 'test123')).toBe(true);
      expect(InterventionChecker['matchPattern']('test*', 'abc123')).toBe(false);
    });

    it('should match colon-based prefix patterns', () => {
      expect(InterventionChecker['matchPattern']('git add:*', 'git add:')).toBe(true);
      expect(InterventionChecker['matchPattern']('git add:*', 'git add:.')).toBe(true);
      expect(InterventionChecker['matchPattern']('git add:*', 'git add:--all')).toBe(true);
      expect(InterventionChecker['matchPattern']('git add:*', 'git commit')).toBe(false);
    });

    it('should match path patterns', () => {
      expect(
        InterventionChecker['matchPattern']('/Users/project/*', '/Users/project/file.ts'),
      ).toBe(true);
      expect(InterventionChecker['matchPattern']('/Users/project/*', '/tmp/file.ts')).toBe(false);
    });
  });

  describe('matchesArgument', () => {
    it('should match exact type', () => {
      const matcher = { pattern: 'git add', type: 'exact' as const };
      expect(InterventionChecker['matchesArgument'](matcher, 'git add')).toBe(true);
      expect(InterventionChecker['matchesArgument'](matcher, 'git add:.')).toBe(false);
    });

    it('should match prefix type', () => {
      const matcher = { pattern: 'git add', type: 'prefix' as const };
      expect(InterventionChecker['matchesArgument'](matcher, 'git add')).toBe(true);
      expect(InterventionChecker['matchesArgument'](matcher, 'git add:.')).toBe(true);
      expect(InterventionChecker['matchesArgument'](matcher, 'git commit')).toBe(false);
    });

    it('should match wildcard type', () => {
      const matcher = { pattern: 'git *', type: 'wildcard' as const };
      expect(InterventionChecker['matchesArgument'](matcher, 'git add')).toBe(true);
      expect(InterventionChecker['matchesArgument'](matcher, 'git commit')).toBe(true);
      expect(InterventionChecker['matchesArgument'](matcher, 'npm install')).toBe(false);
    });

    it('should match regex type', () => {
      const matcher = { pattern: '^git (add|commit)', type: 'regex' as const };
      expect(InterventionChecker['matchesArgument'](matcher, 'git add')).toBe(true);
      expect(InterventionChecker['matchesArgument'](matcher, 'git commit')).toBe(true);
      expect(InterventionChecker['matchesArgument'](matcher, 'git push')).toBe(false);
    });

    it('should handle simple string matcher', () => {
      expect(InterventionChecker['matchesArgument']('git add:*', 'git add:.')).toBe(true);
      expect(InterventionChecker['matchesArgument']('*.ts', 'file.ts')).toBe(true);
      expect(InterventionChecker['matchesArgument']('exact', 'exact')).toBe(true);
    });
  });

  describe('generateToolKey', () => {
    it('should generate key without args hash', () => {
      const key = InterventionChecker.generateToolKey('web-browsing', 'crawlSinglePage');
      expect(key).toBe('web-browsing/crawlSinglePage');
    });

    it('should generate key with args hash', () => {
      const key = InterventionChecker.generateToolKey('bash', 'bash', 'a1b2c3');
      expect(key).toBe('bash/bash#a1b2c3');
    });
  });

  describe('hashArguments', () => {
    it('should generate consistent hash for same arguments', () => {
      const args1 = { command: 'ls -la', path: '/tmp' };
      const args2 = { command: 'ls -la', path: '/tmp' };

      const hash1 = InterventionChecker.hashArguments(args1);
      const hash2 = InterventionChecker.hashArguments(args2);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different arguments', () => {
      const args1 = { command: 'ls -la' };
      const args2 = { command: 'ls -l' };

      const hash1 = InterventionChecker.hashArguments(args1);
      const hash2 = InterventionChecker.hashArguments(args2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle key order independence', () => {
      const args1 = { a: 1, b: 2 };
      const args2 = { b: 2, a: 1 };

      const hash1 = InterventionChecker.hashArguments(args1);
      const hash2 = InterventionChecker.hashArguments(args2);

      expect(hash1).toBe(hash2);
    });

    it('should handle empty arguments', () => {
      const hash = InterventionChecker.hashArguments({});
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    it('should handle complex nested objects', () => {
      const args = {
        config: { nested: { value: 'test' } },
        array: [1, 2, 3],
      };

      const hash = InterventionChecker.hashArguments(args);
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });
  });

  describe('checkSecurityBlacklist', () => {
    it('should return not blocked when blacklist is empty', () => {
      const result = InterventionChecker.checkSecurityBlacklist([], { command: 'rm -rf /' });
      expect(result.blocked).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    describe('with DEFAULT_SECURITY_BLACKLIST', () => {
      it('should block dangerous rm -rf ~/ command', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf ~/',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.rmHomeDir');
      });

      it('should block rm -rf on macOS home directory', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf /Users/alice',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.rmHomeDir');
      });

      it('should block rm -rf on Linux home directory', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf /home/alice',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.rmHomeDir');
      });

      it('should block rm -rf with $HOME variable', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf $HOME',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.rmHomeDir');
      });

      it('should block rm -rf / command', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf /',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.rmRootDir');
      });

      it('should allow safe rm commands', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'rm -rf /tmp/test-folder',
        });
        expect(result.blocked).toBe(false);
      });

      it('should block fork bomb', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: ':(){ :|:& };:',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.forkBomb');
      });

      it('should block dangerous dd commands to disk devices', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'dd if=/dev/zero of=/dev/sda',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.ddDiskWrite');
      });

      it('should block reading .env files via command', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat .env',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.envFiles');
      });

      it('should block reading .env files via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/project/.env.local',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.envFiles');
      });

      it('should block reading SSH private keys via command', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.ssh/id_rsa',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.sshPrivateKeys');
      });

      it('should block reading SSH private keys via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.ssh/id_ed25519',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.sshPrivateKeys');
      });

      it('should allow reading SSH public keys', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.ssh/id_rsa.pub',
        });
        expect(result.blocked).toBe(false);
      });

      it('should block reading AWS credentials via command', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.aws/credentials',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.awsCredentials');
      });

      it('should block reading AWS credentials via path', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.aws/credentials',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.awsCredentials');
      });

      it('should block reading Docker config', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'less ~/.docker/config.json',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.dockerConfig');
      });

      it('should block reading Kubernetes config', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.kube/config',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.kubeConfig');
      });

      it('should block reading Git credentials', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.git-credentials',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.gitCredentials');
      });

      it('should block reading npm token file', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.npmrc',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.npmrc');
      });

      it('should block reading shell history files', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          command: 'cat ~/.bash_history',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.historyFiles');
      });

      it('should block reading GCP credentials', () => {
        const result = InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, {
          path: '/home/user/.config/gcloud/application_default_credentials.json',
        });
        expect(result.blocked).toBe(true);
        expect(result.reason).toBe('securityBlacklist.gcpCredentials');
      });
    });

    describe('with custom blacklist', () => {
      it('should work with multiple parameter matching', () => {
        const blacklist: SecurityBlacklistConfig = [
          {
            description: 'Dangerous operation on system files',
            match: {
              command: { pattern: 'rm.*', type: 'regex' },
              path: '/etc/*',
            },
          },
        ];

        // Both match - should block
        expect(
          InterventionChecker.checkSecurityBlacklist(blacklist, {
            command: 'rm -rf',
            path: '/etc/passwd',
          }).blocked,
        ).toBe(true);

        // Only command matches - should not block
        expect(
          InterventionChecker.checkSecurityBlacklist(blacklist, {
            command: 'rm -rf',
            path: '/tmp/file',
          }).blocked,
        ).toBe(false);

        // Only path matches - should not block
        expect(
          InterventionChecker.checkSecurityBlacklist(blacklist, {
            command: 'cat',
            path: '/etc/passwd',
          }).blocked,
        ).toBe(false);
      });
    });
  });

  describe('shouldIntervene with security blacklist', () => {
    describe('with default blacklist behavior', () => {
      it('should block dangerous commands even in auto-run mode', () => {
        // Even with config set to 'never', default blacklist should override
        const result = InterventionChecker.shouldIntervene({
          config: 'never',
          // Not passing securityBlacklist - should use DEFAULT_SECURITY_BLACKLIST
          toolArgs: { command: 'rm -rf ~/' },
        });

        expect(result).toBe('required');
      });

      it('should block dangerous commands even with no config', () => {
        // Even with no config (which normally means 'never'), default blacklist should override
        const result = InterventionChecker.shouldIntervene({
          config: undefined,
          // Not passing securityBlacklist - should use DEFAULT_SECURITY_BLACKLIST
          toolArgs: { command: 'rm -rf /' },
        });

        expect(result).toBe('required');
      });

      it('should allow safe commands to follow normal intervention rules', () => {
        // Safe command should follow normal config
        const result = InterventionChecker.shouldIntervene({
          config: 'never',
          // Not passing securityBlacklist - should use DEFAULT_SECURITY_BLACKLIST
          toolArgs: { command: 'ls -la' },
        });

        expect(result).toBe('never');
      });

      it('should block reading sensitive files', () => {
        // Test with actual default blacklist for sensitive file reading
        const result = InterventionChecker.shouldIntervene({
          config: 'never',
          // Not passing securityBlacklist - should use DEFAULT_SECURITY_BLACKLIST
          toolArgs: { command: 'cat .env' },
        });

        expect(result).toBe('required');
      });
    });

    describe('with custom blacklist replacement', () => {
      it('should use custom blacklist instead of default when provided', () => {
        const customBlacklist: SecurityBlacklistConfig = [
          {
            description: 'Block all npm commands in production',
            match: {
              command: { pattern: 'npm.*', type: 'regex' },
            },
          },
        ];

        // Custom blacklist blocks npm but not rm
        expect(
          InterventionChecker.shouldIntervene({
            config: 'never',
            securityBlacklist: customBlacklist,
            toolArgs: { command: 'npm install' },
          }),
        ).toBe('required');

        // rm is not in custom blacklist, should follow config
        expect(
          InterventionChecker.shouldIntervene({
            config: 'never',
            securityBlacklist: customBlacklist,
            toolArgs: { command: 'rm -rf ~/' },
          }),
        ).toBe('never');
      });

      it('should support extending default blacklist with custom rules', () => {
        const extendedBlacklist: SecurityBlacklistConfig = [
          ...DEFAULT_SECURITY_BLACKLIST,
          {
            description: 'Block access to production database',
            match: {
              command: { pattern: '.*psql.*production.*', type: 'regex' },
            },
          },
        ];

        // Default rule still works
        expect(
          InterventionChecker.shouldIntervene({
            config: 'never',
            securityBlacklist: extendedBlacklist,
            toolArgs: { command: 'rm -rf ~/' },
          }),
        ).toBe('required');

        // Custom rule works
        expect(
          InterventionChecker.shouldIntervene({
            config: 'never',
            securityBlacklist: extendedBlacklist,
            toolArgs: { command: 'psql -h production.db' },
          }),
        ).toBe('required');

        // Safe commands pass
        expect(
          InterventionChecker.shouldIntervene({
            config: 'never',
            securityBlacklist: extendedBlacklist,
            toolArgs: { command: 'psql -h localhost' },
          }),
        ).toBe('never');
      });

      it('should allow disabling security blacklist by passing empty array', () => {
        // Dangerous command should not be blocked when blacklist is empty
        const result = InterventionChecker.shouldIntervene({
          config: 'never',
          securityBlacklist: [], // Explicitly disable blacklist
          toolArgs: { command: 'rm -rf ~/' },
        });

        expect(result).toBe('never');
      });

      it('should support project-specific blacklist rules', () => {
        const projectBlacklist: SecurityBlacklistConfig = [
          {
            description: 'Block modifying package.json in CI',
            match: {
              path: { pattern: '.*/package\\.json$', type: 'regex' },
              command: { pattern: '(vim|nano|vi|emacs|code|sed).*', type: 'regex' },
            },
          },
        ];

        // Should block editing package.json
        expect(
          InterventionChecker.shouldIntervene({
            config: 'never',
            securityBlacklist: projectBlacklist,
            toolArgs: {
              command: 'vim package.json',
              path: '/project/package.json',
            },
          }),
        ).toBe('required');

        // Should allow reading package.json
        expect(
          InterventionChecker.shouldIntervene({
            config: 'never',
            securityBlacklist: projectBlacklist,
            toolArgs: {
              command: 'cat package.json',
              path: '/project/package.json',
            },
          }),
        ).toBe('never');
      });
    });
  });

  describe('Integration scenarios', () => {
    it('should handle Bash tool scenario', () => {
      const config: HumanInterventionConfig = [
        { match: { command: 'ls:*' }, policy: 'never' },
        { match: { command: 'git add:*' }, policy: 'required' },
        { match: { command: 'git commit:*' }, policy: 'required' },
        { match: { command: 'rm:*' }, policy: 'required' },
        { policy: 'required' },
      ];

      // Safe commands - never
      expect(
        InterventionChecker.shouldIntervene({
          config,
          securityBlacklist: [], // Disable blacklist for this test
          toolArgs: { command: 'ls:' },
        }),
      ).toBe('never');

      // Git commands - require
      expect(
        InterventionChecker.shouldIntervene({
          config,
          securityBlacklist: [], // Disable blacklist for this test
          toolArgs: { command: 'git add:.' },
        }),
      ).toBe('required');
      expect(
        InterventionChecker.shouldIntervene({
          config,
          securityBlacklist: [], // Disable blacklist for this test
          toolArgs: { command: 'git commit:-m' },
        }),
      ).toBe('required');

      // Dangerous commands - require
      expect(
        InterventionChecker.shouldIntervene({
          config,
          securityBlacklist: [], // Disable blacklist for this test
          toolArgs: { command: 'rm:-rf' },
        }),
      ).toBe('required');
      expect(
        InterventionChecker.shouldIntervene({
          config,
          securityBlacklist: [], // Disable blacklist for this test
          toolArgs: { command: 'npm install' },
        }),
      ).toBe('required');
    });

    it('should handle LocalSystem tool scenario', () => {
      const config: HumanInterventionConfig = [
        { match: { path: '/Users/project/*' }, policy: 'never' },
        { policy: 'required' },
      ];

      // Project directory - never
      expect(
        InterventionChecker.shouldIntervene({
          config,
          securityBlacklist: [], // Disable blacklist for this test
          toolArgs: { path: '/Users/project/file.ts' },
        }),
      ).toBe('never');

      // Outside project - require
      expect(
        InterventionChecker.shouldIntervene({
          config,
          securityBlacklist: [], // Disable blacklist for this test
          toolArgs: { path: '/tmp/file.ts' },
        }),
      ).toBe('required');
    });

    it('should handle Web Browsing tool with simple policy', () => {
      const config: HumanInterventionConfig = 'required';

      expect(
        InterventionChecker.shouldIntervene({
          config,
          securityBlacklist: [], // Disable blacklist for this test
          toolArgs: { url: 'https://example.com' },
        }),
      ).toBe('required');
    });

    it('should handle security blacklist overriding user config', () => {
      const config: HumanInterventionConfig = 'never';
      const blacklist: SecurityBlacklistConfig = DEFAULT_SECURITY_BLACKLIST;

      // Dangerous command blocked even with 'never' config
      expect(
        InterventionChecker.shouldIntervene({
          config,
          securityBlacklist: blacklist,
          toolArgs: { command: 'rm -rf /' },
        }),
      ).toBe('required');

      // Safe command follows config
      expect(
        InterventionChecker.shouldIntervene({
          config,
          securityBlacklist: blacklist,
          toolArgs: { command: 'ls -la' },
        }),
      ).toBe('never');
    });
  });
});

import { realpathSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { createSandboxEnv } from '../env';
import { createSandboxLaunchPlan } from '../launchPlan';
import { normalizeSandboxPolicy } from '../policy';
import { srtSandboxRuntime } from '../runtime';
import { createSrtConfig } from '../srt';

const policy = {
  allowNetwork: false,
  onUnavailable: 'deny',
  writableRoots: ['/tmp'],
} as const;

describe('device sandbox launch plan', () => {
  afterEach(async () => {
    await srtSandboxRuntime.shutdown();
  });

  it('fails closed when Sandbox Runtime is unavailable', async () => {
    await expect(
      createSandboxLaunchPlan({
        capability: {
          available: false,
          backend: 'none',
          networkIsolation: false,
          reason: 'missing Sandbox Runtime dependency',
        },
        command: { args: [], cmd: '/bin/echo' },
        policy,
      }),
    ).rejects.toMatchObject({
      code: 'SANDBOX_UNAVAILABLE',
      message: 'missing Sandbox Runtime dependency',
    });
  });

  it('returns an explicit unsandboxed plan only for warn-allow', async () => {
    const plan = await createSandboxLaunchPlan({
      capability: {
        available: false,
        backend: 'none',
        networkIsolation: false,
        reason: 'missing Sandbox Runtime dependency',
      },
      command: { args: ['ok'], cmd: '/bin/echo' },
      policy: { ...policy, onUnavailable: 'warn-allow' },
    });

    expect(plan).toMatchObject({
      args: ['ok'],
      cmd: '/bin/echo',
      sandboxed: false,
      warning: 'missing Sandbox Runtime dependency',
    });
  });

  it('keeps only the default environment and explicit allowlist', () => {
    expect(
      createSandboxEnv(
        { HOME: '/Users/test', LOBE_TEST_ALLOWED: 'yes', LOBE_TEST_SECRET: 'no' },
        { envAllowlist: ['LOBE_TEST_ALLOWED'] },
      ),
    ).toEqual({ HOME: '/Users/test', LOBE_TEST_ALLOWED: 'yes' });
  });

  it('normalizes roots and rejects relative paths', () => {
    expect(
      normalizeSandboxPolicy({ ...policy, writableRoots: ['/tmp/../tmp', '/tmp'] }).writableRoots,
    ).toEqual([realpathSync.native('/tmp')]);
    expect(() => normalizeSandboxPolicy({ ...policy, writableRoots: ['relative'] })).toThrow(
      'must be absolute',
    );
  });

  it('requires an explicit domain allowlist when networking is enabled', () => {
    expect(() => normalizeSandboxPolicy({ ...policy, allowNetwork: true })).toThrow(
      'requires an explicit non-empty domain allowlist',
    );
  });

  it('maps the LobeHub policy to a fail-closed Sandbox Runtime configuration', () => {
    const config = createSrtConfig({
      ...policy,
      allowedNetworkDomains: ['api.github.com'],
      allowNetwork: true,
      deniedReadRoots: ['/tmp'],
      deniedWriteRoots: ['/tmp'],
      readableRoots: ['/tmp'],
    });

    // `windows` is asserted separately below: it carries an absolute path to the
    // staged helper, which exists only on Windows and differs per machine.
    const { windows: _windows, ...portable } = config;
    expect(portable).toEqual({
      allowAppleEvents: false,
      allowPty: false,
      enableWeakerNestedSandbox: false,
      enableWeakerNetworkIsolation: false,
      filesystem: {
        allowRead: [realpathSync.native('/tmp')],
        allowWrite: [realpathSync.native('/tmp')],
        allowGitConfig: false,
        denyRead: [realpathSync.native('/tmp')],
        denyWrite: [realpathSync.native('/tmp')],
      },
      network: {
        allowedDomains: ['api.github.com'],
        allowAllUnixSockets: false,
        allowLocalBinding: false,
        allowUnixSockets: [],
        deniedDomains: [],
        strictAllowlist: true,
      },
    });
  });

  it('overrides the helper path on Windows and nowhere else', () => {
    // The backend resolves its helper relative to its own package directory,
    // which stops being a real location once bundled — so Windows must be told
    // explicitly where the shipped binary is. Other platforms have nothing to
    // relocate and must not carry a stray override.
    const { windows } = createSrtConfig(policy);

    if (process.platform === 'win32') {
      expect(windows?.srtWin?.path).toMatch(/srt-win\.exe$/);
    } else {
      expect(windows).toBeUndefined();
    }
  });
});

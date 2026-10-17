import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canonicalJson } from '../coreOta/manifest';
import { SecurityUpdatePolicy } from '../SecurityUpdatePolicy';

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
let userData: string;
const rule = {
  affectedVersions: '>=1.0.0 <1.2.0',
  channel: 'stable',
  minimumInstallerVersion: '1.2.0',
  platforms: ['darwin'],
  target: 'shell',
};
const signed = (revision = 1, rules = [rule]) => {
  const payload = { kind: 'desktop-security-policy', revision, rules, schemaVersion: 1 };
  return {
    ...payload,
    signature: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString('base64'),
  };
};
const create = (fetchImpl = vi.fn(async () => Response.json(signed())), overrides = {}) =>
  new SecurityUpdatePolicy({
    channel: 'stable',
    coreVersion: () => '1.1.0',
    feedBaseUrl: 'https://updates.test',
    fetchImpl,
    platform: 'darwin',
    publicKey,
    shellVersion: '1.1.0',
    userData,
    ...overrides,
  });
beforeEach(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), 'security-policy-'));
});
afterEach(async () => {
  await rm(userData, { force: true, recursive: true });
});

describe('signed security update policy', () => {
  it('blocks an affected stable shell and refuses vulnerable or insufficient installers', async () => {
    const policy = create();
    expect(await policy.check()).toBe(true);
    expect(policy.isInstallerSafe('1.1.9')).toBe(false);
    expect(policy.isInstallerSafe('invalid')).toBe(false);
    expect(policy.isInstallerSafe('1.2.0')).toBe(true);
  });
  it('enforces the repair minimum even outside the affected range and excludes newly vulnerable installers', async () => {
    const policy = create(
      vi.fn(async () =>
        Response.json(
          signed(1, [
            { ...rule, affectedVersions: '1.1.0', minimumInstallerVersion: '1.3.0' },
            { ...rule, affectedVersions: '1.4.0', minimumInstallerVersion: '1.4.1' },
          ]),
        ),
      ),
    );
    expect(await policy.check()).toBe(true);
    expect(policy.isInstallerSafe('1.2.0')).toBe(false);
    expect(policy.isInstallerSafe('1.3.0')).toBe(true);
    expect(policy.isInstallerSafe('1.4.0')).toBe(false);
  });

  it('supports exact prerelease versions and core-only restrictions', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        signed(1, [
          {
            ...rule,
            channel: 'canary',
            target: 'core',
            affectedVersions: '2.0.0-canary.5',
            minimumInstallerVersion: '2.0.0-canary.6',
          },
        ]),
      ),
    );
    const policy = create(fetchImpl, { channel: 'canary', coreVersion: () => '2.0.0-canary.5' });
    expect(await policy.check()).toBe(true);
    expect(policy.isInstallerSafe('2.0.0-canary.5')).toBe(false);
    expect(policy.isInstallerSafe('2.0.0-canary.6')).toBe(true);
  });
  it('does not block unaffected versions, platforms or channels', async () => {
    for (const overrides of [
      { shellVersion: '1.2.0' },
      { channel: 'canary' },
      { platform: 'win32' },
    ]) {
      expect(await create(undefined, overrides).check()).toBe(false);
    }
  });
  it('rejects tampered policies without locking out an installation', async () => {
    const tampered = signed();
    tampered.rules[0] = { ...rule, affectedVersions: '*' };
    expect(await create(vi.fn(async () => Response.json(tampered))).check()).toBe(false);
  });
  it('retains verified restrictions offline and rejects rollback of a cached policy', async () => {
    expect(await create(vi.fn(async () => Response.json(signed(2)))).check()).toBe(true);
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await create(fetchImpl).check()).toBe(true);
    expect(await create(vi.fn(async () => Response.json(signed(1, [])))).check()).toBe(true);
    expect(await create(vi.fn(async () => Response.json(signed(2, [])))).check()).toBe(true);
    expect(await create(vi.fn(async () => Response.json(signed(3, [])))).check()).toBe(false);
    expect(await create(fetchImpl).check()).toBe(false);
  });
  it('allows ordinary startup if the policy has not been published', async () => {
    expect(await create(vi.fn(async () => new Response('', { status: 404 }))).check()).toBe(false);
  });
  it('rejects malformed signed version ranges', async () => {
    expect(
      await create(
        vi.fn(async () => Response.json(signed(1, [{ ...rule, affectedVersions: 'nonsense' }]))),
      ).check(),
    ).toBe(false);
  });
});

import { execFile } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import { canonicalJson, verifyManifestSignature } from '../../src/common/signedJson.ts';
import { SecurityUpdatePolicy } from '../../src/main/core/infrastructure/SecurityUpdatePolicy';
import { ruleId, runSecurityPolicy, verifyRepairInstallers } from '../desktopSecurityPolicy.mjs';

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const privateKey = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const rule = {
  channel: 'stable',
  platforms: ['win32'],
  target: 'shell',
  affectedVersions: '<1.2.0',
  minimumInstallerVersion: '1.2.0',
};
const signed = (revision, rules) => {
  const payload = { kind: 'desktop-security-policy', schemaVersion: 1, revision, rules };
  return {
    ...payload,
    signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
  };
};
const mark = (overrides = {}) => ({
  action: 'mark',
  apply: true,
  expectedRevision: 0,
  reason: 'Repair a vulnerable installer',
  rule,
  ...overrides,
});
const fixture = (policy = null) => {
  let current = policy;
  const store = {
    read: vi.fn(async () => ({ policy: current, etag: current ? `"${current.revision}"` : null })),
    archive: vi.fn(async () => {}),
    write: vi.fn(async (body, etag) => {
      if (etag !== (current ? `"${current.revision}"` : null))
        throw new Error('PreconditionFailed');
      current = JSON.parse(body);
    }),
  };
  const fetchImpl = vi.fn(async (url, options) => {
    if (url.endsWith('/security-policy.json'))
      return current ? Response.json(current) : new Response('', { status: 404 });
    if (options?.method === 'HEAD')
      return new Response(null, { headers: { 'content-length': '123' } });
    if (url.endsWith('.xml'))
      return new Response(
        `<rss><channel><item><sparkle:shortVersionString>1.2.0</sparkle:shortVersionString><enclosure url="installer.zip" sparkle:edSignature="signature"/></item></channel></rss>`,
      );
    return new Response(
      'version: 1.2.0\nfiles:\n  - url: installer.exe\n    sha512: abc\n  - url: installer.AppImage\n    sha512: def\n',
    );
  });
  return {
    store,
    fetchImpl,
    feedBaseUrl: 'https://updates.test',
    publicKey,
    privateKey,
    wait: async () => {},
  };
};

describe('credential-free workflow request validation', () => {
  const validate = (request) =>
    promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL('../desktopSecurityPolicy.mjs', import.meta.url)),
        '--validate-request',
      ],
      { env: { SECURITY_POLICY_REQUEST: JSON.stringify(request) } },
    );

  it('normalizes inspect and default preview requests without any credentials', async () => {
    const inspection = JSON.parse((await validate({ action: 'inspect' })).stdout);
    expect(inspection).toEqual({ action: 'inspect' });
    const preview = JSON.parse((await validate(mark({ apply: undefined }))).stdout);
    expect(preview.apply).toBe(false);
    expect(preview.rule).toEqual(rule);
  });

  it('allows the signing branch only for an explicitly true, valid mutation', async () => {
    const publication = JSON.parse((await validate(mark())).stdout);
    expect(publication.apply).toBe(true);
    expect(publication.action).toBe('mark');
    await expect(validate(mark({ apply: 'true' }))).rejects.toMatchObject({ stdout: '' });
    await expect(validate({ action: 'inspect', apply: true })).rejects.toMatchObject({
      stdout: '',
    });
    await expect(validate(mark({ expectedRevision: undefined }))).rejects.toMatchObject({
      stdout: '',
    });
  });
});

describe('security policy publication', () => {
  it('previews a valid restriction without requiring a signing key or writing objects', async () => {
    const env = fixture();
    const result = await runSecurityPolicy({
      ...env,
      privateKey: undefined,
      request: mark({ apply: false }),
    });
    expect(result.status).toBe('preview');
    expect(result.after.revision).toBe(1);
    expect(result.installers).toHaveLength(1);
    expect(env.store.write).not.toHaveBeenCalled();
    expect(env.store.archive).not.toHaveBeenCalled();
  });

  it('publishes a client-verifiable rule while preserving unrelated channels', async () => {
    const unrelated = { ...rule, channel: 'canary' };
    const env = fixture(signed(4, [unrelated]));
    const result = await runSecurityPolicy({ ...env, request: mark({ expectedRevision: 4 }) });
    const { policy } = await env.store.read();
    expect(result.status).toBe('verified');
    expect(policy.revision).toBe(5);
    expect(policy.rules).toEqual([unrelated, rule]);
    expect(verifyManifestSignature(policy, publicKey)).toBe(true);
    const userData = await mkdtemp(path.join(os.tmpdir(), 'policy-client-'));
    try {
      const client = new SecurityUpdatePolicy({
        channel: 'stable',
        coreVersion: () => '1.0.0',
        shellVersion: '1.0.0',
        platform: 'win32',
        userData,
        publicKey,
        feedBaseUrl: env.feedBaseUrl,
        fetchImpl: env.fetchImpl,
      });
      expect(await client.check()).toBe(true);
      expect(client.isInstallerSafe('1.2.0')).toBe(true);
      await runSecurityPolicy({
        ...env,
        request: {
          action: 'revoke',
          apply: true,
          expectedRevision: 5,
          reason: 'Resolved',
          ruleId: ruleId(rule),
        },
      });
      expect(await client.check()).toBe(false);
      expect((await env.store.read()).policy.rules).toEqual([unrelated]);
    } finally {
      await rm(userData, { recursive: true, force: true });
    }
  });

  it('revokes the last rule with a newer signed empty policy and no installer fetch', async () => {
    const env = fixture(signed(1, [rule]));
    const result = await runSecurityPolicy({
      ...env,
      request: {
        action: 'revoke',
        apply: true,
        expectedRevision: 1,
        reason: 'Withdraw',
        ruleId: ruleId(rule),
      },
    });
    expect(result.after).toEqual({ revision: 2, rules: [] });
    expect((await env.store.read()).policy.rules).toEqual([]);
    expect(env.fetchImpl.mock.calls.every(([url]) => url.endsWith('/security-policy.json'))).toBe(
      true,
    );
  });

  it('does not bump revision or write for an identical mark', async () => {
    const env = fixture(signed(1, [rule]));
    expect(
      (await runSecurityPolicy({ ...env, request: mark({ expectedRevision: 1 }) })).status,
    ).toBe('no-change');
    expect(env.store.write).not.toHaveBeenCalled();
  });

  it('refuses stale revisions before feed requests or writes', async () => {
    const env = fixture(signed(2, [rule]));
    await expect(runSecurityPolicy({ ...env, request: mark() })).rejects.toThrow(
      'expected revision 0, found 2',
    );
    expect(env.store.write).not.toHaveBeenCalled();
    expect(env.fetchImpl).not.toHaveBeenCalled();
  });

  it('does not overwrite a concurrent publication after planning', async () => {
    const env = fixture();
    env.store.archive.mockImplementationOnce(async () =>
      env.store.write(JSON.stringify(signed(1, [{ ...rule, channel: 'canary' }])), null),
    );
    await expect(runSecurityPolicy({ ...env, request: mark() })).rejects.toThrow(
      'PreconditionFailed',
    );
    expect((await env.store.read()).policy.rules[0].channel).toBe('canary');
  });

  it('refuses an invalid stored signature and mismatched private key without writing', async () => {
    const invalid = fixture({ ...signed(1, [rule]), revision: 3 });
    await expect(runSecurityPolicy({ ...invalid, request: { action: 'inspect' } })).rejects.toThrow(
      'signature invalid',
    );
    const env = fixture();
    const otherKey = generateKeyPairSync('ed25519')
      .privateKey.export({ format: 'pem', type: 'pkcs8' })
      .toString();
    await expect(
      runSecurityPolicy({ ...env, privateKey: otherKey, request: mark() }),
    ).rejects.toThrow('Signing key does not match');
    expect(env.store.archive).not.toHaveBeenCalled();
    expect(env.store.write).not.toHaveBeenCalled();
  });

  it('reports a successful write with stale public delivery as unverified, then exposes it on inspect', async () => {
    const env = fixture();
    const fetchImpl = async (url, options) =>
      url.endsWith('/security-policy.json')
        ? new Response('', { status: 404 })
        : env.fetchImpl(url, options);
    const record = vi.fn();
    await expect(runSecurityPolicy({ ...env, fetchImpl, record, request: mark() })).rejects.toThrow(
      'Policy was written but public verification failed',
    );
    expect(record.mock.calls.at(-1)[0].status).toBe('published-unverified');
    expect(env.store.write).toHaveBeenCalledTimes(1);
    const result = await runSecurityPolicy({ ...env, fetchImpl, request: { action: 'inspect' } });
    expect(result.before.revision).toBe(1);
    expect(result.publicRevision).toBeNull();
    expect(result.publicError).toContain('404');
  });

  it('refuses to publish when the fixed installer is unavailable', async () => {
    const env = fixture();
    const fetchImpl = (url, options) =>
      options?.method === 'HEAD' ? new Response('', { status: 404 }) : env.fetchImpl(url, options);
    await expect(runSecurityPolicy({ ...env, fetchImpl, request: mark() })).rejects.toThrow(
      'Installer unavailable',
    );
    expect(env.store.write).not.toHaveBeenCalled();
  });

  it('rejects an installer covered by another restriction', async () => {
    const env = fixture(
      signed(1, [{ ...rule, affectedVersions: '1.2.0', minimumInstallerVersion: '1.2.1' }]),
    );
    await expect(
      runSecurityPolicy({ ...env, request: mark({ expectedRevision: 1 }) }),
    ).rejects.toThrow('does not satisfy');
    expect(env.store.write).not.toHaveBeenCalled();
  });

  it('checks both macOS architectures and the Beta Canary feed', async () => {
    const env = fixture();
    const betaRule = { ...rule, channel: 'beta', platforms: ['darwin', 'linux', 'win32'] };
    const result = await verifyRepairInstallers({
      ...env,
      policy: { rules: [betaRule] },
      rule: betaRule,
    });
    expect(result.map((entry) => entry.feed)).toEqual([
      'https://updates.test/canary/appcast-arm64.xml',
      'https://updates.test/canary/appcast-x64.xml',
      'https://updates.test/canary/canary-linux.yml',
      'https://updates.test/canary/canary.yml',
    ]);
    const fetchImpl = (url, options) =>
      url.endsWith('appcast-x64.xml')
        ? new Response('', { status: 404 })
        : env.fetchImpl(url, options);
    await expect(
      runSecurityPolicy({ ...env, fetchImpl, request: mark({ rule: betaRule }) }),
    ).rejects.toThrow('404');
    expect(env.store.write).not.toHaveBeenCalled();
  });

  it('refuses cross-origin installer URLs', async () => {
    const env = fixture();
    const fetchImpl = async () =>
      new Response(
        'version: 1.2.0\nfiles:\n  - url: https://elsewhere.test/install.exe\n    sha512: abc\n',
      );
    await expect(runSecurityPolicy({ ...env, fetchImpl, request: mark() })).rejects.toThrow(
      'outside the channel feed',
    );
    expect(env.store.write).not.toHaveBeenCalled();
  });
});

it('executes the real Node CLI and S3 conditional writes against isolated HTTP storage', async () => {
  const objects = new Map();
  const requests = [];
  let failWrite = false;
  const server = createServer(async (req, res) => {
    const key = new URL(req.url, 'http://localhost').pathname;
    if (key === '/stable/stable.yml')
      return res.end('version: 1.2.0\nfiles:\n  - url: installer.exe\n    sha512: abc\n');
    if (key === '/stable/installer.exe') {
      res.setHeader('content-length', '123');
      return res.end();
    }
    const storedKey = key === '/security-policy.json' ? '/bucket/security-policy.json' : key;
    const existing = objects.get(storedKey);
    if (req.method === 'PUT') {
      requests.push({ key, match: req.headers['if-match'], none: req.headers['if-none-match'] });
      if (key === '/bucket/security-policy.json' && failWrite) {
        failWrite = false;
        res.writeHead(500, { 'Content-Type': 'application/xml' });
        return res.end('<Error><Code>InternalError</Code></Error>');
      }
      if (
        (req.headers['if-none-match'] === '*' && existing) ||
        (req.headers['if-match'] && req.headers['if-match'] !== existing?.etag)
      ) {
        res.writeHead(412, { 'Content-Type': 'application/xml' });
        return res.end('<Error><Code>PreconditionFailed</Code></Error>');
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      const etag = `"revision-${JSON.parse(body).revision}"`;
      objects.set(storedKey, { body, etag });
      res.setHeader('ETag', etag);
      return res.end();
    }
    if (!existing) {
      res.writeHead(404, { 'Content-Type': 'application/xml' });
      return res.end('<Error><Code>NoSuchKey</Code></Error>');
    }
    res.setHeader('ETag', existing.etag);
    res.end(existing.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'policy-cli-'));
  const requestFile = path.join(dir, 'request.json');
  const reportFile = path.join(dir, 'report.json');
  const execute = async (request) => {
    await writeFile(requestFile, JSON.stringify(request));
    await promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL('../desktopSecurityPolicy.mjs', import.meta.url)),
        '--request',
        requestFile,
        '--output',
        reportFile,
      ],
      {
        env: {
          ...process.env,
          UPDATE_SERVER_URL: base,
          UPDATE_S3_ENDPOINT: base,
          UPDATE_S3_REGION: 'auto',
          UPDATE_S3_BUCKET: 'bucket',
          UPDATE_AWS_ACCESS_KEY_ID: 'test-access',
          UPDATE_AWS_SECRET_ACCESS_KEY: 'test-secret',
          RENDERER_OTA_PUBLIC_KEY: publicKey,
          RENDERER_OTA_PRIVATE_KEY: privateKey,
        },
      },
    );
    return JSON.parse(await readFile(reportFile, 'utf8'));
  };
  try {
    expect((await execute({ action: 'inspect' })).before.revision).toBe(0);
    expect((await execute(mark({ apply: false }))).status).toBe('preview');
    expect(objects.size).toBe(0);
    failWrite = true;
    await expect(execute(mark())).rejects.toThrow();
    expect((await execute({ action: 'inspect' })).before.revision).toBe(0);
    expect(objects.size).toBe(1); // History exists, but the live pointer was not written.
    expect((await execute(mark())).status).toBe('verified');
    const live = JSON.parse(objects.get('/bucket/security-policy.json').body);
    expect(verifyManifestSignature(live, publicKey)).toBe(true);
    expect(
      (
        await execute({
          action: 'revoke',
          apply: true,
          expectedRevision: 1,
          reason: 'Resolved',
          ruleId: ruleId(rule),
        })
      ).status,
    ).toBe('verified');
    expect(JSON.parse(objects.get('/bucket/security-policy.json').body).rules).toEqual([]);
    expect(requests.filter((entry) => entry.key === '/bucket/security-policy.json')).toEqual([
      { key: '/bucket/security-policy.json', match: undefined, none: '*' },
      { key: '/bucket/security-policy.json', match: undefined, none: '*' },
      { key: '/bucket/security-policy.json', match: '"revision-1"', none: undefined },
    ]);
    expect(objects.size).toBe(3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

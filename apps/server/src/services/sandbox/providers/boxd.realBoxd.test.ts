// @vitest-environment node
import { createHash, randomBytes } from 'node:crypto';

import type { Boxd } from '@boxd-sh/sdk';
import { strToU8, zipSync } from 'fflate';
import { sha256 } from 'js-sha256';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MarketService } from '@/server/services/market';

import type { BoxdSandboxProvider as BoxdSandboxProviderClass } from './boxd';

/**
 * Runs the boxd provider against real boxd computers. Skipped unless
 * `BOXD_REAL_API_KEY` is set; every computer it creates is deleted in `afterAll`:
 *
 *   BOXD_REAL_API_KEY=bxd_... BOXD_REAL_REGION=fra \
 *     bunx vitest run apps/server/src/services/sandbox/providers/boxd.realBoxd.test.ts
 *
 * The export and skill checks also need a bucket the computer can reach; they
 * are skipped without `BOXD_REAL_S3_ENDPOINT`, `BOXD_REAL_S3_BUCKET`,
 * `BOXD_REAL_S3_ACCESS_KEY_ID` and `BOXD_REAL_S3_SECRET_ACCESS_KEY`. The
 * snapshot check creates a snapshot named `lobehub-review-snap-*` and deletes it.
 */
const apiKey = process.env.BOXD_REAL_API_KEY;
const s3 = {
  accessKeyId: process.env.BOXD_REAL_S3_ACCESS_KEY_ID,
  bucket: process.env.BOXD_REAL_S3_BUCKET,
  endpoint: process.env.BOXD_REAL_S3_ENDPOINT,
  secretAccessKey: process.env.BOXD_REAL_S3_SECRET_ACCESS_KEY,
};
const hasS3 = Boolean(s3.endpoint && s3.bucket && s3.accessKeyId && s3.secretAccessKey);

const userId = 'boxd-real-test';
const topicId = `topic-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
const computerName = (scopeKey: string) => `lobehub-${sha256(scopeKey).slice(0, 20)}`;
const timings: Record<string, number> = {};

const timed = async <T>(label: string, run: () => Promise<T>) => {
  const started = performance.now();
  const value = await run();
  timings[label] = Math.round(performance.now() - started);
  return value;
};

describe.skipIf(!apiKey)('BoxdSandboxProvider (real boxd)', { timeout: 180_000 }, () => {
  let BoxdSandboxProvider: typeof BoxdSandboxProviderClass;
  let boxd: Boxd;
  const names = new Set<string>([computerName(`topic:${userId}:${topicId}`)]);
  const snapshots = new Set<string>();

  const provider = (options: Record<string, unknown> = {}) =>
    new BoxdSandboxProvider({ marketService: {} as MarketService, topicId, userId, ...options });

  const run = async (command: string, options: Record<string, unknown> = {}) => {
    const result = await provider().callTool('runCommand', { command, ...options });
    expect(result.success).toBe(true);
    return result.result as {
      exitCode: number;
      stderr: string;
      stdout: string;
      stdoutBytes?: number;
      truncated?: boolean;
    };
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const computer = () => boxd.machines.get(computerName(`topic:${userId}:${topicId}`));

  beforeAll(async () => {
    vi.resetModules();
    process.env.SANDBOX_PROVIDER = 'boxd';
    process.env.BOXD_API_KEY = apiKey;
    if (process.env.BOXD_REAL_REGION) process.env.BOXD_REGION = process.env.BOXD_REAL_REGION;
    BoxdSandboxProvider = (await import('./boxd')).BoxdSandboxProvider;
    const { Boxd: Client } = await import('@boxd-sh/sdk');
    boxd = new Client({ apiKey, region: process.env.BOXD_REAL_REGION });
  });

  afterAll(async () => {
    if (!boxd) return;
    for (const snapshot of snapshots) {
      await boxd.snapshots.delete(snapshot).catch(() => undefined);
    }
    for (const name of names) {
      await boxd.machines
        .get(name)
        .then((machine) => boxd.machines.delete(machine.id))
        .catch(() => undefined);
    }
    const left = (await boxd.machines.list({ labels: { app: 'lobehub' } })).filter((machine) =>
      names.has(machine.name),
    );
    console.info('[boxd-real] timings (ms)', JSON.stringify(timings));
    console.info('[boxd-real] computers left after cleanup:', left.length);
    expect(left).toEqual([]);
    await boxd.close();
  }, 180_000);

  it('creates an isolated, leased computer on first use and keeps stdout, stderr and the exit code apart', async () => {
    const result = await timed('first call (create + ready + command)', () =>
      run('echo out; echo err >&2; echo "$GREETING"; exit 42', { env: { GREETING: 'hello' } }),
    );

    expect(result).toMatchObject({ exitCode: 42, stderr: 'err\n', stdout: 'out\nhello\n' });

    const machine = await computer();
    expect(machine.labels).toMatchObject({ app: 'lobehub' });
    expect(machine.networking.isolated).toBe(true);
    expect(machine.ssh).toBe(false);
    expect(machine.botProtectionMode).toBe('on');
    expect(machine.deleteAt).toBeTruthy();
    const leaseLeft = (new Date(machine.deleteAt!).getTime() - Date.now()) / 1000;
    expect(leaseLeft).toBeGreaterThan(800);
    expect(leaseLeft).toBeLessThanOrEqual(900);

    const inside = await run('command -v boxd || echo no-boxd-cli; pwd; ls -ld /mnt/data');
    expect(inside.stdout).toContain('no-boxd-cli');
    expect(inside.stdout).toContain('/home/boxd/workspace');
    expect(inside.stdout).toMatch(/boxd boxd .* \/mnt\/data/);
  });

  it('reuses the topic computer from a new provider instance', async () => {
    await run('echo kept > marker.txt');
    const result = await timed('warm command', () => run('cat marker.txt'));

    expect(result.stdout).toBe('kept\n');
    const listed = await boxd.machines.list({ labels: { app: 'lobehub' } });
    expect(listed.filter((machine) => names.has(machine.name))).toHaveLength(1);
  });

  it('runs python, javascript and typescript', async () => {
    for (const [language, code] of [
      ['python', 'print(6 * 7)'],
      ['javascript', 'console.log(6 * 7)'],
      ['typescript', 'const n: number = 6 * 7; console.log(n)'],
    ]) {
      const result = await timed(`executeCode ${language}`, () =>
        provider().callTool('executeCode', { code, language }),
      );
      expect(result.result).toMatchObject({ exitCode: 0, output: '42\n' });
    }
  });

  it('reads, writes, edits, moves, renames and searches files', async () => {
    const p = provider();
    await p.callTool('writeFile', { content: 'alpha\nbeta\ngamma\n', path: 'src/notes.txt' });
    await p.callTool('writeLocalFile', { content: 'export const x = 1;\n', path: 'src/x.ts' });

    expect(
      (await p.callTool('readFile', { endLine: 2, path: 'src/notes.txt', startLine: 2 })).result,
    ).toMatchObject({
      content: 'beta\n',
      totalLineCount: 3,
    });
    expect(
      (await p.callTool('editFile', { path: 'src/notes.txt', replace: 'BETA', search: 'beta' }))
        .result,
    ).toMatchObject({
      replacements: 1,
    });
    const listed = await p.callTool('listFiles', { directoryPath: 'src' });
    expect((listed.result?.files as { name: string }[]).map((file) => file.name)).toEqual([
      'notes.txt',
      'x.ts',
    ]);

    const grep = await p.callTool('grepContent', { directory: 'src', pattern: 'BET' });
    expect(grep.result).toMatchObject({
      matches: [{ content: 'BETA', lineNumber: 2 }],
      totalMatches: 1,
    });
    const glob = await p.callTool('globFiles', { directory: '.', pattern: '**/*.{ts,txt}' });
    expect(glob.result?.totalCount).toBe(3);
    const search = await p.callTool('searchFiles', { directory: '.', keywords: 'notes' });
    expect((search.result?.results as { name: string }[]).map((file) => file.name)).toEqual([
      'notes.txt',
    ]);

    await p.callTool('runCommand', { command: 'mkdir -p archive' });
    const moved = await p.callTool('moveFiles', {
      operations: [{ destination: 'archive', source: 'src/x.ts' }],
    });
    expect(moved.result).toMatchObject({ successCount: 1 });
    const renamed = await p.callTool('renameLocalFile', {
      newName: 'y.ts',
      oldPath: 'archive/x.ts',
    });
    expect(renamed.result).toMatchObject({ newPath: '/home/boxd/workspace/archive/y.ts' });

    const missing = await p.callTool('readFile', { path: 'nope.txt' });
    expect(missing.success).toBe(false);
  });

  it('writes 5 MiB intact and reads it back as a window under the read cap', async () => {
    const content = randomBytes(3_932_160).toString('base64');
    expect(content.length).toBe(5_242_880);
    const p = provider();

    await timed('writeFile 5 MiB', () => p.callTool('writeFile', { content, path: 'big.txt' }));
    const read = await timed('readFile 5 MiB (windowed)', () =>
      p.callTool('readFile', { path: 'big.txt' }),
    );
    const remote = await run('sha256sum big.txt');

    expect(remote.stdout.split(' ')[0]).toBe(createHash('sha256').update(content).digest('hex'));
    expect(read.result).toMatchObject({
      totalCharCount: 5_242_880,
      totalLineCount: 1,
      truncated: true,
    });
    const window = String(read.result?.content);
    expect(window.startsWith(content.slice(0, 500_000))).toBe(true);
    expect(window).toContain('[Truncated at 500000 characters.');

    const small = content.slice(0, 400_000);
    await p.callTool('writeFile', { content: small, path: 'small.txt' });
    expect((await p.callTool('readFile', { path: 'small.txt' })).result?.content).toBe(small);
  });

  it('cuts a 200 MB stdout inside the computer, so this process never holds it', async () => {
    const before = process.memoryUsage().rss;
    const result = await timed('200 MB stdout', () =>
      run("head -c 200000000 /dev/zero | tr '\\0' a"),
    );
    const grown = process.memoryUsage().rss - before;
    console.info('[boxd-real] rss growth for a 200 MB stdout (MB):', Math.round(grown / 1e6));

    expect(result).toMatchObject({ exitCode: 0, stdoutBytes: 200_000_000, truncated: true });
    expect(result.stdout.length).toBeLessThan(300_000);
    expect(result.stdout).toContain(`[... ${200_000_000 - 262_144} bytes of output left out ...]`);
    expect(grown).toBeLessThan(64 * 1024 * 1024);
  });

  it('returns exit code 124 on timeout and stops the command', async () => {
    const result = await timed('2 s timeout', () =>
      run('sleep 45 && touch late.txt', { timeout: 2000 }),
    );

    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain('background: true');
    const after = await run('sleep 1; pgrep -f "slee[p] 45" || echo none');
    expect(after.stdout.trim()).toBe('none');
  });

  it('runs background commands, returns only new output, reports the exit code and kills on request', async () => {
    const p = provider();
    const started = await p.callTool('runCommand', {
      background: true,
      command: 'for i in 1 2 3; do echo tick $i; sleep 1; done; echo done >&2',
    });
    const commandId = String(started.result?.commandId);

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const first = await p.callTool('getCommandOutput', { commandId });
    expect(first.result).toMatchObject({ running: true });
    expect(String(first.result?.output)).toContain('tick 1');

    await new Promise((resolve) => setTimeout(resolve, 3000));
    const second = await provider().callTool('getCommandOutput', { commandId });
    expect(second.result).toMatchObject({ exitCode: 0, running: false, stderr: 'done\n' });
    expect(String(second.result?.output)).not.toContain('tick 1');
    expect(String(second.result?.output)).toContain('tick 3');

    const server = await p.callTool('runCommand', {
      background: true,
      command: 'python3 -m http.server 8765',
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const served = await run('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8765/');
    expect(served.stdout).toBe('200');

    const killed = await p.callTool('killCommand', { commandId: server.result?.commandId });
    expect(killed.success).toBe(true);
    const gone = await p.callTool('getCommandOutput', { commandId: server.result?.commandId });
    expect(gone.result).toMatchObject({ running: false, signal: 'SIGTERM' });
    expect((await run('pgrep -f "http.serve[r] 8765" || echo none')).stdout.trim()).toBe('none');

    // The command exits at once and leaves its child in the group: killCommand still ends it.
    const parent = await p.callTool('runCommand', {
      background: true,
      command: 'sleep 321 & echo started',
    });
    await sleep(1500);
    const finished = await p.callTool('getCommandOutput', { commandId: parent.result?.commandId });
    expect(finished.result).toMatchObject({ exitCode: 0, running: false });
    expect((await run('pgrep -f "slee[p] 321" || echo none')).stdout.trim()).not.toBe('none');
    expect((await p.callTool('killCommand', { commandId: parent.result?.commandId })).success).toBe(
      true,
    );
    expect((await run('sleep 1; pgrep -f "slee[p] 321" || echo none')).stdout.trim()).toBe('none');
  });

  it('answers scripts on the public HTTPS address with the bot check, not with what a command serves', async () => {
    const p = provider();
    await run('echo topic-secret > secret.txt');
    const server = await p.callTool('runCommand', {
      background: true,
      command: 'python3 -m http.server 8000',
    });
    await sleep(4000);
    expect((await run('curl -s http://127.0.0.1:8000/secret.txt')).stdout).toBe('topic-secret\n');

    const { access } = await computer();
    const response = await fetch(`${access.url}/secret.txt`, { redirect: 'manual' });
    const body = await response.text();
    console.info('[boxd-real] public GET', access.url, '->', response.status);

    expect(response.status).toBe(503);
    expect(body).not.toContain('topic-secret');
    await p.callTool('killCommand', { commandId: server.result?.commandId });
  });

  it('wakes from standby and hibernation, and starts a stopped computer', async () => {
    const { id } = await computer();

    await boxd.machines.pause(id);
    expect((await timed('command after standby', () => run('echo awake'))).stdout).toBe('awake\n');

    await boxd.machines.hibernate(id);
    expect((await timed('command after hibernate', () => run('cat marker.txt'))).stdout).toBe(
      'kept\n',
    );

    await boxd.machines.stop(id);
    expect((await timed('command after stop', () => run('cat marker.txt'))).stdout).toBe('kept\n');
  });

  it.skipIf(!hasS3)('exports a 5 MiB file from the computer to a presigned URL', async () => {
    const { S3Client, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const client = new S3Client({
      credentials: { accessKeyId: s3.accessKeyId!, secretAccessKey: s3.secretAccessKey! },
      endpoint: s3.endpoint,
      forcePathStyle: true,
      region: 'us-east-1',
    });
    const key = `boxd-real/${topicId}/export.bin`;
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: s3.bucket, Key: key }),
      {
        expiresIn: 600,
      },
    );

    const remote = await run('head -c 5242880 /dev/urandom > export.bin && sha256sum export.bin');
    const exported = await timed('export 5 MiB', () =>
      provider().exportFileToUploadUrl({ filename: 'export.bin', path: 'export.bin', uploadUrl }),
    );
    expect(exported).toMatchObject({
      mimeType: 'application/octet-stream',
      size: 5_242_880,
      success: true,
    });

    const downloadUrl = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: s3.bucket, Key: key }),
    );
    const bytes = Buffer.from(await (await fetch(downloadUrl)).arrayBuffer());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(remote.stdout.split(' ')[0]);
  });

  it.skipIf(!hasS3)('runs a skill script from its archive', async () => {
    const { S3Client, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const client = new S3Client({
      credentials: { accessKeyId: s3.accessKeyId!, secretAccessKey: s3.secretAccessKey! },
      endpoint: s3.endpoint,
      forcePathStyle: true,
      region: 'us-east-1',
    });
    const key = `boxd-real/${topicId}/skill.zip`;
    const archive = zipSync({
      'run.py': strToU8('import os\nprint("skill ran in", os.getcwd().split("/")[-1])\n'),
    });
    await client.send(new PutObjectCommand({ Body: archive, Bucket: s3.bucket, Key: key }));
    const zipUrl = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: s3.bucket, Key: key }),
      {
        expiresIn: 600,
      },
    );

    const result = await timed('execScript with skill archive', () =>
      provider().callTool('execScript', {
        activatedSkills: [{ name: 'demo-skill' }],
        command: 'python3 run.py',
        skillZipUrls: { 'demo-skill': zipUrl },
      }),
    );

    expect(result.result).toMatchObject({ exitCode: 0, stdout: 'skill ran in demo-skill\n' });
  });

  it('restores BOXD_SNAPSHOT computers isolated, with SSH off and bot protection on', async () => {
    const snapshot = `lobehub-review-snap-${randomBytes(4).toString('hex')}`;
    snapshots.add(snapshot);
    await run('echo from-snapshot > snapshot-marker.txt');
    await boxd.snapshots.create((await computer()).id, snapshot);
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const { status } = await boxd.snapshots.get(snapshot);
      if (status === 'ready') break;
      if (status === 'failed') throw new Error(`snapshot ${snapshot} failed`);
      await sleep(2000);
    }

    vi.resetModules();
    process.env.BOXD_SNAPSHOT = snapshot;
    const { BoxdSandboxProvider: FromSnapshot } = await import('./boxd');
    delete process.env.BOXD_SNAPSHOT;
    const snapshotTopic = `${topicId}-snapshot`;
    const name = computerName(`topic:${userId}:${snapshotTopic}`);
    names.add(name);

    const result = await timed('first call from snapshot', () =>
      new FromSnapshot({
        marketService: {} as MarketService,
        topicId: snapshotTopic,
        userId,
      }).callTool('runCommand', {
        command: 'cat snapshot-marker.txt; command -v boxd || echo no-boxd-cli',
      }),
    );

    expect(result.result).toMatchObject({ exitCode: 0, stdout: 'from-snapshot\nno-boxd-cli\n' });
    const machine = await boxd.machines.get(name);
    expect(machine.networking.isolated).toBe(true);
    expect(machine.ssh).toBe(false);
    expect(machine.botProtectionMode).toBe('on');
  }, 240_000);

  it('replaces a computer deleted out from under it and says so', async () => {
    const before = await computer();
    await boxd.machines.delete(before.id);

    const result = await timed('call after the computer was deleted', () =>
      provider().callTool('runCommand', { command: 'ls marker.txt || echo fresh' }),
    );

    expect(result).toMatchObject({
      result: { stdout: 'fresh\n' },
      sessionExpiredAndRecreated: true,
      success: true,
    });
    expect((await computer()).id).not.toBe(before.id);
  });
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { parse } from 'yaml';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('v4 publication verifies packs before advancing latest and never writes the v3 feed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pack-publish-'));
  try {
    const action = parse(
      await readFile(
        new URL('../actions/desktop-publish-core-ota/action.yml', import.meta.url),
        'utf8',
      ),
    );
    const script = action.runs.steps[0].run;
    const dir = path.join(root, 'release/core-v4/darwin');
    await mkdir(path.join(dir, 'packs'), { recursive: true });
    await mkdir(path.join(dir, 'versions'), { recursive: true });
    const bytes = Buffer.from('compressed frame fixture');
    const sha256 = digest(bytes);
    const packPath = `packs/${sha256}.pack`;
    await writeFile(path.join(dir, packPath), bytes);
    const manifest = {
      version: '1',
      seq: 1,
      packs: [{ sha256, path: packPath, size: bytes.length }],
      objects: {
        [sha256]: { compressedSha256: sha256, length: bytes.length, offset: 0, packSha256: sha256 },
      },
      patches: [],
    };
    for (const file of ['latest.json', 'versions/1.json'])
      await writeFile(path.join(dir, file), JSON.stringify(manifest));
    await writeFile(
      path.join(root, 'aws'),
      `#!/usr/bin/env node
const fs=require('fs');
const args=process.argv.slice(2);
fs.appendFileSync(process.env.AWS_CALLS,JSON.stringify(args)+'\\n');
if(args[0]==='s3' && args[1]==='ls') process.exit(1);
if(args[0]==='s3' && args[1]==='cp' && args[3]==='-') {
  process.stdout.write(process.env.BAD_PACK==='1' ? 'corrupt' : fs.readFileSync(process.env.PACK_FILE));
}
if(args[0]==='s3api') {
  const bytes=fs.readFileSync(process.env.PACK_FILE);
  fs.writeFileSync(args.at(-1),bytes);
  process.stdout.write(JSON.stringify({ContentRange:'bytes 0-'+(bytes.length-1)+'/'+bytes.length}));
}
`,
    );
    await chmod(path.join(root, 'aws'), 0o755);
    for (const [appVersion, bad] of [
      ['1.0.0', '1'],
      ['1.0.0', '0'],
      ['2.0.0-canary.1', '0'],
    ]) {
      const log = path.join(root, `calls-${appVersion}-${bad}.jsonl`);
      const result = spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          APP_VERSION: appVersion,
          AWS_CALLS: log,
          BAD_PACK: bad,
          CHANNEL: 'stable',
          CORE_DIR: 'core-v4',
          GITHUB_OUTPUT: path.join(root, 'output'),
          PACK_FILE: path.join(dir, packPath),
          PATH: `${root}:${process.env.PATH}`,
          RELEASE_DIR: path.join(root, 'release'),
          S3_BUCKET: 'fixture',
          S3_ENDPOINT: '',
          SHELL_JSON: '',
        },
      });
      const calls = (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const expectedPrefix = `s3://fixture/stable/${appVersion}/core-v4/darwin/`;
      for (const args of calls) {
        for (const arg of args.filter((value) => value.startsWith('s3://')))
          assert(arg.startsWith(expectedPrefix), `Unexpected cross-version access: ${arg}`);
        if (args[0] === 's3api')
          assert(
            args[args.indexOf('--key') + 1].startsWith(`stable/${appVersion}/core-v4/darwin/`),
          );
      }
      const writes = calls.filter(
        (args) => args[0] === 's3' && args[1] === 'cp' && args[3].startsWith('s3://'),
      );
      assert.equal(
        writes.some((args) => args[3].includes('/stable/core/')),
        false,
      );
      assert.equal(
        writes.some((args) => args[3].endsWith('/latest.json')),
        bad === '0',
        result.stderr,
      );
      assert.equal(result.status === 0, bad === '0', result.stderr);
      console.log(
        JSON.stringify({
          scenario: bad === '1' ? 'corrupt-upload' : 'valid-upload',
          latestPublished: bad === '0',
          v3Untouched: true,
        }),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('v4 seq allocation only reads the owning app version across platforms', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pack-seq-'));
  try {
    const action = parse(
      await readFile(new URL('../actions/desktop-core-seq/action.yml', import.meta.url), 'utf8'),
    );
    await writeFile(
      path.join(root, 'curl'),
      `#!/usr/bin/env node
const fs=require('fs');const args=process.argv.slice(2);const url=args.at(-1);
fs.appendFileSync(process.env.URL_LOG,url+'\\n');
const match=url.match(/\\/stable\\/([^/]+)\\/core-v4\\/(darwin|win32|linux)\\/latest.json$/);
if(!match) process.exit(2);
if(match[1]==='2.0.0'){process.stdout.write('404');process.exit(0);}
fs.writeFileSync(args[args.indexOf('-o')+1],JSON.stringify({seq:match[2]==='darwin'?7:3}));process.stdout.write('200');
`,
    );
    await chmod(path.join(root, 'curl'), 0o755);
    for (const [appVersion, expected] of [
      ['1.0.0', 8],
      ['2.0.0', 0],
    ]) {
      const output = path.join(root, `output-${appVersion}`);
      const log = path.join(root, `urls-${appVersion}`);
      const result = spawnSync('bash', ['-c', action.runs.steps[0].run], {
        encoding: 'utf8',
        env: {
          ...process.env,
          APP_VERSION: appVersion,
          CHANNEL: 'stable',
          UPDATE_SERVER_URL: 'https://updates.test/stable',
          RUNNER_TEMP: root,
          GITHUB_OUTPUT: output,
          URL_LOG: log,
          PATH: `${root}:${process.env.PATH}`,
        },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(await readFile(output, 'utf8'), new RegExp(`seq=${expected}\\n`));
      const urls = (await readFile(log, 'utf8')).trim().split('\n');
      assert.equal(urls.length, 3);
      assert(
        urls.every((url) => url.startsWith(`https://updates.test/stable/${appVersion}/core-v4/`)),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

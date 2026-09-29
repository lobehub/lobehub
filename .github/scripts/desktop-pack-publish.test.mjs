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
    for (const bad of ['1', '0']) {
      const log = path.join(root, `calls-${bad}.jsonl`);
      const result = spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: {
          ...process.env,
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

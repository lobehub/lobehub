// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compileFixtureTools } from './compileFixtureTools';
import { runIsolatedProcess, sandboxProfile } from './isolatedProcess';

const owned: string[] = [];
afterEach(async () => {
  for (const root of owned.splice(0)) await rm(root, { force: true, recursive: true });
});

describe('build process boundary', () => {
  it('does not allow network or writes to source and dependency files', () => {
    const profile = sandboxProfile('/task', ['/bin/node']);
    expect(profile).toContain('(deny default)');
    expect(profile).not.toContain('allow network');
    expect(profile).toContain('(allow file-write* (subpath "/task/.stylex-tools")');
  });

  it('rejects writable paths outside the tool namespace', () => {
    expect(() => sandboxProfile('/task', ['/bin/node'], '/task/source')).toThrow(
      'BUILD_WRITE_SCOPE_ESCAPE',
    );
  });

  it.skipIf(process.platform !== 'darwin')(
    'cannot overwrite another component build namespace',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'stylex-build-namespace-test-'));
      owned.push(root);
      const first = path.join(root, '.stylex-tools/fixtures/One');
      const second = path.join(root, '.stylex-tools/fixtures/Two');
      await mkdir(first, { recursive: true });
      await mkdir(second, { recursive: true });
      const other = path.join(second, 'output.txt');
      await writeFile(other, 'preserve');
      const code = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(path.join(first, 'output.txt'))},'own');try{fs.writeFileSync(${JSON.stringify(other)},'changed');console.log('WRITE')}catch{console.log('other-denied')}`;
      const result = await runIsolatedProcess(
        root,
        process.execPath,
        ['-e', code],
        [process.execPath],
        first,
      );
      expect(result.stdout.trim()).toBe('other-denied');
      expect(await readFile(other, 'utf8')).toBe('preserve');
      expect(await readFile(path.join(first, 'output.txt'), 'utf8')).toBe('own');
    },
  );

  it.skipIf(process.platform !== 'darwin')(
    'executes transpiled local plugins without consulting ancestor configuration',
    async () => {
      const parent = await mkdtemp(path.join(tmpdir(), 'stylex-sandbox-tool-test-'));
      owned.push(parent);
      const root = path.join(parent, 'nested/snapshot');
      await mkdir(path.join(root, '.stylex-tools/tmp'), { recursive: true });
      await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
      await writeFile(path.join(parent, 'tsconfig.json'), 'must not load ancestor configuration');
      await writeFile(path.join(root, 'tsconfig.json'), '{}');
      await writeFile(
        path.join(root, 'entry.ts'),
        'import {value} from "./value"; console.log(value);',
      );
      await writeFile(path.join(root, 'value.ts'), 'export const value: number = 42;');
      await compileFixtureTools(root, [{ source: 'entry.ts', output: 'entry.mjs' }]);
      const result = await runIsolatedProcess(
        root,
        process.execPath,
        [path.join(root, '.stylex-tools/compiler/entry.mjs')],
        [process.execPath],
      );
      expect(result.stdout.trim()).toBe('42');
    },
  );

  it.skipIf(process.platform !== 'darwin')(
    'permits tool output but denies source writes, outside reads and outbound network',
    async () => {
      const parent = await mkdtemp(path.join(tmpdir(), 'stylex-sandbox-test-'));
      owned.push(parent);
      const root = path.join(parent, 'snapshot');
      await mkdir(path.join(root, '.stylex-tools/tmp'), { recursive: true });
      const outside = path.join(parent, 'outside.txt');
      await writeFile(outside, 'must not read');
      const source = path.join(root, 'source.txt');
      await writeFile(source, 'preserve');
      const code = `const fs=require('node:fs');const net=require('node:net');const results=[];try{fs.readFileSync(${JSON.stringify(outside)});results.push('LEAK')}catch{results.push('outside-denied')}try{fs.writeFileSync(${JSON.stringify(source)},'changed');results.push('WRITE')}catch{results.push('source-denied')}fs.writeFileSync('.stylex-tools/output.txt','safe');const socket=net.connect({host:'127.0.0.1',port:9});socket.on('error',()=>{results.push('network-denied');console.log(JSON.stringify(results));});setTimeout(()=>process.exit(3),2000).unref();`;
      const result = await runIsolatedProcess(
        root,
        process.execPath,
        ['-e', code],
        [process.execPath],
      );
      expect(JSON.parse(result.stdout)).toEqual([
        'outside-denied',
        'source-denied',
        'network-denied',
      ]);
      expect(await readFile(source, 'utf8')).toBe('preserve');
      expect(await readFile(path.join(root, '.stylex-tools/output.txt'), 'utf8')).toBe('safe');
    },
  );
});

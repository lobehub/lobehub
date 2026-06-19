import fs from 'node:fs';
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  editLocalFile,
  ensurePathWithin,
  readLocalFile,
  resolveWithinRoot,
  writeLocalFile,
} from '../index';

describe('ensurePathWithin', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    // realpath so the temp dir matches what the helper resolves to (macOS maps
    // /var -> /private/var, /tmp -> /private/tmp).
    const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lfs-contain-')));
    root = path.join(base, 'workdir');
    outside = path.join(base, 'outside');
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(path.dirname(root), { force: true, recursive: true });
  });

  it('allows everything when no working directory is supplied (backward compatible)', async () => {
    const r = await ensurePathWithin('/etc/anything', undefined);
    expect(r.allowed).toBe(true);
  });

  it('allows a path inside the working directory', async () => {
    const r = await ensurePathWithin(path.join(root, 'a/b.txt'), root);
    expect(r.allowed).toBe(true);
  });

  it('allows the working directory itself', async () => {
    const r = await ensurePathWithin(root, root);
    expect(r.allowed).toBe(true);
  });

  it('rejects an absolute path outside the working directory', async () => {
    const r = await ensurePathWithin(path.join(outside, 'secret.txt'), root);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('escapes');
  });

  it('rejects a `..` escape', async () => {
    const r = await ensurePathWithin(path.join(root, '../outside/secret.txt'), root);
    expect(r.allowed).toBe(false);
  });

  it('rejects a sibling-prefix path (root-name confusion)', async () => {
    // `${root}-evil` shares the string prefix `${root}` but is NOT contained.
    const r = await ensurePathWithin(`${root}-evil/secret.txt`, root);
    expect(r.allowed).toBe(false);
  });

  it('rejects a write that escapes via a symlinked parent directory', async () => {
    // root/link -> outside ; writing to root/link/secret.txt must be rejected
    // because it really lands in `outside`.
    await symlink(outside, path.join(root, 'link'), 'dir');
    const r = await ensurePathWithin(path.join(root, 'link', 'secret.txt'), root);
    expect(r.allowed).toBe(false);
  });
});

describe('resolveWithinRoot', () => {
  it('joins a relative target to the working directory', () => {
    expect(resolveWithinRoot('src/App.tsx', '/repo')).toBe(path.join('/repo', 'src/App.tsx'));
  });

  it('leaves an already-absolute target unchanged', () => {
    const abs = path.join('/abs', 'file.txt');
    expect(resolveWithinRoot(abs, '/repo')).toBe(abs);
  });

  it('leaves the target unchanged when no working directory is given', () => {
    expect(resolveWithinRoot('src/App.tsx', undefined)).toBe('src/App.tsx');
  });
});

describe('file sinks honor workingDirectory containment', () => {
  let root: string;
  let outsideFile: string;

  beforeEach(async () => {
    const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lfs-sink-')));
    root = path.join(base, 'workdir');
    await mkdir(root, { recursive: true });
    outsideFile = path.join(base, 'outside-secret.txt');
    await writeFile(outsideFile, 'TOP SECRET');
  });

  afterEach(() => {
    fs.rmSync(path.dirname(root), { force: true, recursive: true });
  });

  // ── writeLocalFile ──

  it('writeLocalFile blocks a path outside the working directory', async () => {
    const target = path.join(path.dirname(root), 'escaped.txt');
    const result = await writeLocalFile({
      content: 'pwned',
      path: target,
      workingDirectory: root,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('escapes');
    // The decisive assertion: the file was NOT written outside the root.
    expect(fs.existsSync(target)).toBe(false);
  });

  it('writeLocalFile still writes inside the working directory', async () => {
    const target = path.join(root, 'nested', 'ok.txt');
    const result = await writeLocalFile({
      content: 'fine',
      path: target,
      workingDirectory: root,
    });

    expect(result.success).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('fine');
  });

  it('writeLocalFile is unchanged when no workingDirectory is given (backward compatible)', async () => {
    const target = path.join(path.dirname(root), 'legacy.txt');
    const result = await writeLocalFile({ content: 'legacy', path: target });

    expect(result.success).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('legacy');
  });

  // ── readLocalFile ──

  it('readLocalFile blocks reading a file outside the working directory', async () => {
    const result = await readLocalFile({ path: outsideFile, workingDirectory: root });

    expect(result.content).toContain('escapes');
    expect(result.content).not.toContain('TOP SECRET');
    expect(result.charCount).toBe(0);
  });

  it('readLocalFile reads a file inside the working directory', async () => {
    const inside = path.join(root, 'inside.txt');
    await writeFile(inside, 'hello inside');

    const result = await readLocalFile({ path: inside, workingDirectory: root });
    expect(result.content).toContain('hello inside');
  });

  // ── editLocalFile ──

  it('editLocalFile blocks editing a file outside the working directory', async () => {
    const result = await editLocalFile({
      file_path: outsideFile,
      new_string: 'HACKED',
      old_string: 'TOP SECRET',
      workingDirectory: root,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('escapes');
    // The decisive assertion: the outside file is untouched.
    expect(fs.readFileSync(outsideFile, 'utf8')).toBe('TOP SECRET');
  });

  it('editLocalFile edits a file inside the working directory', async () => {
    const inside = path.join(root, 'edit.txt');
    await writeFile(inside, 'before');

    const result = await editLocalFile({
      file_path: inside,
      new_string: 'after',
      old_string: 'before',
      workingDirectory: root,
    });

    expect(result.success).toBe(true);
    expect(fs.readFileSync(inside, 'utf8')).toBe('after');
  });

  // ── relative paths resolve against workingDirectory (not process.cwd) ──

  it('writeLocalFile resolves a relative path against the working directory', async () => {
    const result = await writeLocalFile({
      content: 'rel',
      path: 'nested/rel.txt',
      workingDirectory: root,
    });

    expect(result.success).toBe(true);
    // Written under the root, NOT under process.cwd().
    expect(fs.readFileSync(path.join(root, 'nested', 'rel.txt'), 'utf8')).toBe('rel');
  });

  it('readLocalFile resolves a relative path against the working directory', async () => {
    await writeFile(path.join(root, 'rel-read.txt'), 'relative hello');

    const result = await readLocalFile({ path: 'rel-read.txt', workingDirectory: root });
    expect(result.content).toContain('relative hello');
  });

  it('still rejects a relative `..` escape against the working directory', async () => {
    const result = await writeLocalFile({
      content: 'pwned',
      path: '../rel-escape.txt',
      workingDirectory: root,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('escapes');
    expect(fs.existsSync(path.join(path.dirname(root), 'rel-escape.txt'))).toBe(false);
  });
});

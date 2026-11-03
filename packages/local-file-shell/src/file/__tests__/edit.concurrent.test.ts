import { chmod, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { editLocalFile } from '../edit';
import { writeLocalFile } from '../write';

// call_tools_batch runs unordered tool calls with Promise.all and the desktop
// gateway handles each tool_call_request without a queue, so parallel editFile
// calls on one path reach editLocalFile concurrently.
describe('editLocalFile — concurrent edits to the same file', () => {
  let dir: string;
  let file: string;
  const base =
    Array.from({ length: 2000 }, (_, i) => `第${i}行「中文正文」 anchor_${i}_end`).join('\n') +
    '\n';

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'edit-concurrent-'));
    file = path.join(dir, 'doc.md');
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it('applies every edit that reports success', async () => {
    for (let trial = 0; trial < 20; trial++) {
      await writeFile(file, base, 'utf8');

      const results = await Promise.all([
        editLocalFile({
          file_path: file,
          new_string: 'anchor_600_end<E0>' + '「插」'.repeat(7) + 'x</E0>',
          old_string: 'anchor_600_end',
        }),
        editLocalFile({
          file_path: file,
          new_string: 'anchor_1300_end<E1>' + '「插」'.repeat(40) + 'xx</E1>',
          old_string: 'anchor_1300_end',
        }),
      ]);
      const onDisk = await readFile(file, 'utf8');

      expect(results.map((r) => r.success)).toEqual([true, true]);
      expect(onDisk).toContain('</E0>');
      expect(onDisk).toContain('</E1>');
      expect(onDisk).not.toContain('�');
      expect(onDisk.match(/anchor_1999_end/g)).toHaveLength(1);
    }
    // 20 serialized trials; the default 5s is too tight on a loaded CI runner.
  }, 30_000);

  it('queues a writeFile and an editFile to one path instead of interleaving them', async () => {
    for (let trial = 0; trial < 20; trial++) {
      await writeFile(file, base, 'utf8');

      const [write, edit] = await Promise.all([
        writeLocalFile({ content: base.replace('anchor_5_end', 'anchor_5_end<W/>'), path: file }),
        editLocalFile({
          file_path: file,
          new_string: 'anchor_1900_end<E/>',
          old_string: 'anchor_1900_end',
        }),
      ]);
      const onDisk = await readFile(file, 'utf8');

      // The write lands first (emission order), then the edit applies on top of it.
      expect([write.success, edit.success]).toEqual([true, true]);
      expect(onDisk).toContain('<W/>');
      expect(onDisk).toContain('<E/>');
    }
  }, 30_000);

  it('never shows a concurrent reader an empty or half-written file', async () => {
    // Large enough that a truncate-then-write takes several event-loop turns.
    const large =
      Array.from({ length: 30_000 }, (_, i) => `第${i}行「中文正文」 anchor_${i}_end`).join('\n') +
      '\n';
    await writeFile(file, large, 'utf8');
    const edits = Array.from({ length: 10 }, (_, i) =>
      editLocalFile({
        file_path: file,
        new_string: `anchor_${i * 100}_end<E${i}/>\n`,
        old_string: `anchor_${i * 100}_end\n`,
      }),
    );
    const reads: string[] = [];
    let settled = false;
    const reader = (async () => {
      while (!settled) reads.push(await readFile(file, 'utf8'));
    })();

    const results = await Promise.all(edits);
    settled = true;
    await reader;

    expect(results.every((r) => r.success)).toBe(true);
    // Every snapshot a reader saw was a complete file, never an empty or half-written one.
    expect(reads.length).toBeGreaterThan(0);
    for (const snapshot of reads) expect(snapshot.endsWith('anchor_29999_end\n')).toBe(true);
  }, 30_000);

  it('keeps a symlink and the file mode when replacing the content', async () => {
    const target = path.join(dir, 'target.sh');
    await writeFile(target, 'echo old\n', 'utf8');
    await chmod(target, 0o755);
    await symlink(target, file);

    const result = await editLocalFile({ file_path: file, new_string: 'new', old_string: 'old' });

    expect(result.success).toBe(true);
    expect((await lstat(file)).isSymbolicLink()).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('echo new\n');
    expect((await stat(target)).mode & 0o777).toBe(0o755);
  });
});

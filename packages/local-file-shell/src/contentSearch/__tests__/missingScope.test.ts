import fs from 'node:fs';
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { globLocalFiles } from '../../file/glob';
import { createFileSearchModule } from '../../fileSearch';
import { MacOSContentSearchImpl } from '../impl/macOS';
import type { UnixContentSearch } from '../impl/unix';

/**
 * A scope that doesn't exist used to be indistinguishable from "nothing
 * matched": `rg` gets an unusable cwd and prints nothing, `fast-glob` returns an
 * empty list. The agent then concludes the CODE is missing and starts revising
 * the pattern — the one hypothesis the search never had evidence for. Both
 * search families must name the missing directory instead.
 */
describe('missing search scope', () => {
  const missingScope = path.join(os.tmpdir(), 'lobehub-missing-scope-fixture', 'src', 'locales');
  const realScope = fs.mkdtempSync(path.join(os.tmpdir(), 'lobehub-scope-'));

  afterAll(() => {
    fs.rmSync(realScope, { force: true, recursive: true });
  });

  it('should report a grep scope that does not exist', async () => {
    const impl = new MacOSContentSearchImpl();

    const result = await impl.grep({
      output_mode: 'content',
      pattern: 'anything',
      scope: missingScope,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(`Search scope does not exist: ${missingScope}`);
    expect(result.total_matches).toBe(0);
  });

  it('should still search a scope that exists', async () => {
    fs.writeFileSync(path.join(realScope, 'chat.json'), '{ "tps": "tok/s" }');
    const impl = new MacOSContentSearchImpl();

    const result = await impl.grep({
      output_mode: 'content',
      pattern: 'tps',
      scope: realScope,
    });

    expect(result.success).toBe(true);
    expect(result.total_matches).toBe(1);
  });

  it('should report a glob scope that does not exist', async () => {
    const result = await createFileSearchModule().glob({
      pattern: '**/*.json',
      scope: missingScope,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(`Search scope does not exist: ${missingScope}`);
    expect(result.total_files).toBe(0);
  });

  it('should report a missing scope from the standalone fast-glob helper', async () => {
    const result = await globLocalFiles({ pattern: '**/*.json', scope: missingScope });

    expect(result.success).toBe(false);
    expect(result.error).toBe(`Search scope does not exist: ${missingScope}`);
  });

  // `stat` failing is not the same as the path being gone. An unreadable parent
  // (EACCES), a symlink loop, a transient fd exhaustion — all throw for a scope
  // that exists, and answering "does not exist" there is a confidently wrong
  // diagnosis, which is worse than the vague one this guard replaces. Those
  // reach the engine, whose own error is the accurate one.
  it.skipIf(process.getuid?.() === 0)(
    'should not claim a scope is missing when it merely cannot be read',
    async () => {
      const lockedParent = fs.mkdtempSync(path.join(os.tmpdir(), 'lobehub-locked-'));
      const child = path.join(lockedParent, 'repo');
      fs.mkdirSync(child);
      fs.chmodSync(lockedParent, 0o000);

      try {
        // Precondition: the scope EXISTS, but stat'ing it fails with something
        // other than ENOENT — otherwise this case proves nothing.
        const statCode = await stat(child).then(
          () => undefined,
          (error: NodeJS.ErrnoException) => error.code,
        );
        expect(statCode).toBe('EACCES');

        const grep = await new MacOSContentSearchImpl().grep({
          output_mode: 'content',
          pattern: 'anything',
          scope: child,
        });
        const glob = await globLocalFiles({ pattern: '**/*', scope: child });

        expect(grep.error ?? '').not.toContain('does not exist');
        expect(glob.error ?? '').not.toContain('does not exist');
      } finally {
        fs.chmodSync(lockedParent, 0o700);
        fs.rmSync(lockedParent, { force: true, recursive: true });
      }
    },
  );

  // A file-scoped search is a documented call shape, not a missing scope.
  it('should accept a scope pointing at a single file', async () => {
    const file = path.join(realScope, 'single.json');
    fs.writeFileSync(file, '{ "tps": "tok/s" }');
    const impl: UnixContentSearch = new MacOSContentSearchImpl();

    const result = await impl.grep({ output_mode: 'content', pattern: 'tps', scope: file });

    expect(result.success).toBe(true);
    expect(result.total_matches).toBe(1);
  });
});

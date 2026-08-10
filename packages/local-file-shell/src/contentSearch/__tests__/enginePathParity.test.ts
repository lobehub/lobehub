import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { GrepContentParams, GrepContentResult } from '../../types';
import { UnixContentSearch } from '../impl/unix';

/**
 * Integration guard for the invariant this module keeps getting wrong: **which
 * engine ran must not change what the caller gets back.**
 *
 * Three ways it used to leak through, all observed in one real agent run:
 *  - external tools emitted `./rel/path` while the Node fallback emitted absolute
 *    paths, so the agent resolved results against the wrong root and hit ENOENT;
 *  - `grep` and the Node fallback ignored `.gitignore`, flooding results with
 *    build output the other engines never surface;
 *  - one failed call permanently pinned the shared instance to the Node fallback,
 *    so every later search silently changed behaviour.
 */
class ForcedEngine extends UnixContentSearch {
  constructor(private readonly forced: 'grep' | 'nodejs' | 'rg') {
    super();
  }

  async grep(params: GrepContentParams): Promise<GrepContentResult> {
    return this.forced === 'nodejs'
      ? (this as any).grepWithNodejs(params)
      : (this as any).grepWithExternalTool(this.forced, params);
  }

  get engine() {
    return (this as any).currentTool;
  }

  setEngine(tool: string) {
    (this as any).currentTool = tool;
  }
}

const hasTool = async (tool: string) => {
  try {
    await execa('which', [tool], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
};

let repo: string;
let engines: Array<'grep' | 'nodejs' | 'rg'>;

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'content-search-parity-'));
  await mkdir(path.join(repo, 'dist', 'sub'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'build'), { recursive: true });
  await writeFile(path.join(repo, '.gitignore'), 'dist/\n*.log\n');
  await writeFile(path.join(repo, 'src', 'a.ts'), 'needle\n');
  await writeFile(
    path.join(repo, 'src', 'ctx.ts'),
    ['one', 'two', 'ctxmark first', 'four', 'five', 'six', 'seven', 'ctxmark second', 'nine'].join(
      '\n',
    ) + '\n',
  );
  await writeFile(path.join(repo, 'src', 'noisy.log'), 'needle\n');
  await writeFile(path.join(repo, 'dist', 'b.js'), 'needle\n');
  await writeFile(path.join(repo, 'dist', 'sub', 'c.js'), 'needle\n');
  // A *tracked* `build/` — the shape of `apps/desktop/build/entitlements.mac.plist`.
  await writeFile(path.join(repo, 'build', 'entitlements.plist'), 'needle\n');
  await execa('git', ['init', '-q'], { cwd: repo });

  engines = ['nodejs'];
  if (await hasTool('rg')) engines.push('rg');
  if (await hasTool('grep')) engines.push('grep');
}, 60_000);

afterAll(async () => {
  if (repo) await rm(repo, { force: true, recursive: true });
});

const search = (engine: 'grep' | 'nodejs' | 'rg', params: GrepContentParams) =>
  new ForcedEngine(engine).grep(params);

describe('content search engine parity', () => {
  it('returns the same gitignore-respecting result set from every engine', async () => {
    const results = await Promise.all(
      engines.map(async (engine) => {
        const r = await search(engine, {
          output_mode: 'files_with_matches',
          pattern: 'needle',
          scope: repo,
        } as GrepContentParams);
        return [engine, [...r.matches].sort()] as const;
      }),
    );

    // `dist/` and `*.log` are gitignored and must go; the tracked `build/` must
    // stay, because only git decides what is build output — not the folder name.
    for (const [engine, matches] of results) {
      expect(matches, `${engine} should honour .gitignore`).toEqual([
        path.join(repo, 'build', 'entitlements.plist'),
        path.join(repo, 'src', 'a.ts'),
      ]);
    }
  }, 60_000);

  it('does not hide a tracked directory whose name looks like build output', async () => {
    // Regression: a hardcoded `!**/build/**` made every engine skip this file,
    // even though git tracks it.
    const tracked = path.join(repo, 'build', 'entitlements.plist');

    for (const engine of engines) {
      const r = await search(engine, {
        output_mode: 'files_with_matches',
        pattern: 'needle',
        scope: repo,
      } as GrepContentParams);

      expect(r.matches, `${engine} hid a tracked build/ file`).toContain(tracked);
    }
  }, 60_000);

  it('returns absolute paths from every engine', async () => {
    for (const engine of engines) {
      const r = await search(engine, {
        output_mode: 'files_with_matches',
        pattern: 'needle',
        scope: repo,
      } as GrepContentParams);

      for (const match of r.matches) {
        expect(path.isAbsolute(match), `${engine} returned a relative path: ${match}`).toBe(true);
      }
    }
  }, 60_000);

  it('still searches a directory the caller explicitly scopes into, even if ignored', async () => {
    for (const engine of engines) {
      const r = await search(engine, {
        output_mode: 'files_with_matches',
        pattern: 'needle',
        scope: path.join(repo, 'dist'),
      } as GrepContentParams);

      expect(
        [...r.matches].sort(),
        `${engine} should search an explicitly scoped ignored dir`,
      ).toEqual([path.join(repo, 'dist', 'b.js'), path.join(repo, 'dist', 'sub', 'c.js')]);
    }
  }, 60_000);

  it('reports the real match count for a file-scoped search with context lines', async () => {
    // Regression: with `-A`/`-B` the match count comes from a second `-c` run,
    // which used the raw scope as its `cwd`. A file scope made that spawn throw
    // and the catch silently returned 0 — so the summary said "Found 0 matches"
    // while the output right below it contained the match lines, and the agent
    // reading the summary kept retrying with new patterns.
    const file = path.join(repo, 'src', 'ctx.ts');

    for (const engine of engines) {
      const r = await search(engine, {
        '-A': 2,
        '-B': 2,
        '-n': true,
        'output_mode': 'content',
        'pattern': 'ctxmark',
        'scope': file,
      } as GrepContentParams);

      expect(r.total_matches, `${engine} miscounted a file-scoped context search`).toBe(2);
      expect(r.matches.length, `${engine} should include context lines`).toBeGreaterThan(2);
    }
  }, 60_000);

  it('prefixes the file path when scope names a single file', async () => {
    const file = path.join(repo, 'src', 'a.ts');

    for (const engine of engines) {
      const r = await search(engine, {
        '-n': true,
        'output_mode': 'content',
        'pattern': 'needle',
        'scope': file,
      } as GrepContentParams);

      expect(r.matches.length, `${engine} found nothing in a file-scoped search`).toBeGreaterThan(
        0,
      );
      for (const match of r.matches) {
        expect(match.startsWith(file), `${engine} dropped the filename prefix: ${match}`).toBe(
          true,
        );
      }
    }
  }, 60_000);
});

describe('engine downgrade', () => {
  it('does not pin the shared instance to the fallback after a file-scoped call', async () => {
    if (!(await hasTool('rg'))) return;

    const impl = new ForcedEngine('rg');
    impl.setEngine('rg');

    // Scoping at a file used to make execa throw (its `cwd` must be a directory).
    // The catch overwrote `currentTool`, so from then on every search in the
    // process ran on the Node fallback — no ignore files, different path shape.
    await impl
      .grep({
        '-n': true,
        'output_mode': 'content',
        'pattern': 'needle',
        'scope': path.join(repo, 'src', 'a.ts'),
      } as GrepContentParams)
      .catch(() => undefined);

    expect(impl.engine).toBe('rg');
  }, 60_000);
});

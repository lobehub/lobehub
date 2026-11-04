// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { measureBuild } from './baseline';

let dir: string;

const write = (file: string, content: string) => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), content);
};

afterEach(() => rmSync(dir, { force: true, recursive: true }));

describe('measureBuild', () => {
  it('counts only the assets the HTML loads, under either asset base', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'stylex-baseline-'));
    write('assets/entry.js', 'a'.repeat(100));
    write('vendor/react.js', 'b'.repeat(50));
    write('assets/lazy.js', 'c'.repeat(1000));
    write('assets/entry.css', ':root{--lh-stylex:1}.lh1abcd{color:red}.lh2efgh:not(#\\#){top:0}');
    write(
      'apps/desktop/index.html',
      [
        '<script type="module" src="/assets/entry.js"></script>',
        '<link rel="modulepreload" href="/_spa/vendor/react.js">',
        '<link rel="modulepreload" href="/assets/entry.js">',
        '<link rel="stylesheet" href="/assets/entry.css">',
      ].join(''),
    );

    const build = measureBuild(dir, 'apps/desktop/index.html');

    expect(build.initialJs.map((s) => [s.file, s.raw])).toEqual([
      ['assets/entry.js', 100],
      ['vendor/react.js', 50],
    ]);
    expect(build.initialCss.map((s) => s.file)).toEqual(['assets/entry.css']);
    expect(build.allJs.raw).toBe(1150);
    expect(build.stylexRules).toBe(2);
  });
});

// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');

/** CSS Modules hash `#id` selectors like class names, so `#some-id` never matches the real element. */
export const findLocalIdSelectors = (css: string) => {
  const withoutComments = css.replaceAll(/\/\*[\S\s]*?\*\//g, '');
  const selectors = withoutComments
    .replaceAll(/:global\([^)]*\)/g, '')
    .replaceAll(/\{[^}]*\}/g, '{}');
  return [...new Set([...selectors.matchAll(/#([A-Z_][\w-]*)/gi)].map((m) => `#${m[1]}`))];
};

describe('CSS module id selectors', () => {
  it('flags an id that is not wrapped in :global', () => {
    expect(findLocalIdSelectors('.panel #toggle { width: 0; }')).toEqual(['#toggle']);
    expect(findLocalIdSelectors('.panel :global(#toggle) { width: 0; }')).toEqual([]);
    expect(findLocalIdSelectors('/* #toggle */ .panel { color: red; }')).toEqual([]);
  });

  it('are always written as :global(#id) in the repo', () => {
    const files = execFileSync('git', ['ls-files', '*.module.css'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);

    const offenders = files.flatMap((file) =>
      findLocalIdSelectors(readFileSync(path.join(repoRoot, file), 'utf8')).map(
        (id) => `${file} ${id}`,
      ),
    );

    expect(offenders).toEqual([]);
  });
});

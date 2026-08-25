import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const target = path.join(dir, entry);

    if (statSync(target).isDirectory()) return walk(target);

    return target.endsWith('route.ts') ? [target] : [];
  });

const devShells = walk(path.resolve(root, 'src/app'))
  .flatMap((file) => {
    const source = readFileSync(file, 'utf8');

    return [...source.matchAll(/fetchViteDevTemplate\('(\/[^']+\.html)'\)/g)].map((match) => ({
      file: path.relative(root, file),
      template: match[1]!,
    }));
  })
  .sort((a, b) => a.template.localeCompare(b.template));

const entrySrc = (html: string) =>
  html.match(/<script type="module" src="([^"]+)"><\/script>/)?.[1];

describe('dev SPA shells', () => {
  it('finds every route handler that fetches a named dev template', () => {
    expect(devShells.map((shell) => shell.template)).toEqual([
      '/index.auth.html',
      '/index.workbench.html',
    ]);
  });

  // Vite falls back to the main `index.html` for a missing root shell, so a typo
  // or a forgotten file boots the main SPA under the micro app's URL instead of
  // failing — silently, and only in dev.
  it.each(devShells)('$template exists at the repo root for $file', ({ template }) => {
    expect(existsSync(path.resolve(root, `.${template}`))).toBe(true);
  });

  it.each(
    devShells.filter(({ template }) =>
      existsSync(path.resolve(root, `apps/${template.slice(7, -5)}/index.html`)),
    ),
  )('$template points at its own app entry, not the main SPA', ({ template }) => {
    const app = template.slice(7, -5);
    const rootShell = readFileSync(path.resolve(root, `.${template}`), 'utf8');
    const appShell = readFileSync(path.resolve(root, `apps/${app}/index.html`), 'utf8');

    expect(entrySrc(rootShell)).toBe(`/apps/${app}/src/entry.tsx`);
    expect(entrySrc(appShell)).toBe('/src/entry.tsx');
    expect(rootShell.replace(`/apps/${app}/src/entry.tsx`, '/src/entry.tsx')).toBe(appShell);
  });
});

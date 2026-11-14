import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runComparison } from '../run';

const fixtures = path.resolve(import.meta.dirname, '../../test/fixtures');
const rootModules = path.resolve(import.meta.dirname, '../../../../node_modules');
let repo: string;
let records: string;

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

const HEAD_FILES: Record<string, string> = {
  'src/Actions.module.css':
    '.actions {\n  display: flex;\n}\n\n.actionButton {\n  flex: 1;\n  min-height: 44px;\n}\n',
  'src/Actions.tsx': `import { Button, Image } from 'fixture-ui';

import actions from './Actions.module.css';
import footer from './Footer.module.css';
import thumb from './Thumb.module.css';

export const Actions = () => (
  <div className={actions.actions}>
    <Button className={actions.actionButton}>Go</Button>
  </div>
);

export const Footer = () => (
  <div className={footer.footer}>
    <Button className={footer.footerButton}>Send</Button>
  </div>
);

export const Thumb = () => (
  <div className={thumb.thumb}>
    <Image alt="" classNames={{ image: thumb.thumbImage }} />
  </div>
);
`,
  'src/Footer.module.css':
    '.footer {\n  display: block;\n}\n\n.footerButton {\n  min-height: 40px;\n}\n',
  'src/Thumb.module.css':
    '.thumb {\n  width: 56px;\n}\n\n.thumbImage {\n  width: 100%;\n  object-fit: cover;\n}\n',
};

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'style-eq-shape-'));
  records = await mkdtemp(path.join(tmpdir(), 'style-eq-shape-records-'));
  await cp(path.join(fixtures, 'shape-repo'), repo, { recursive: true });
  await symlink(rootModules, path.join(repo, 'node_modules'));
  await writeFile(path.join(repo, '.gitignore'), 'node_modules\n');
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('add', '.');
  git('commit', '-qm', 'base');
  for (const [file, content] of Object.entries(HEAD_FILES))
    await writeFile(path.join(repo, file), content);
  git('commit', '-qam', 'head');
}, 30_000);

afterAll(async () => {
  await rm(repo, { force: true, recursive: true });
  await rm(records, { force: true, recursive: true });
});

describe('a library component the parent rule reached through its rendered DOM', () => {
  it('learns the shape, pairs the moved class and compares the real components', async () => {
    const result = await runComparison({
      base: 'HEAD~1',
      calibrate: false,
      configFile: path.join(fixtures, 'shape-project/style-equivalence.config.ts'),
      head: 'HEAD',
      mutations: 0,
      recordsDir: records,
      repo,
    });
    expect(result.plans[0].unpaired).toEqual([]);
    const byKey = Object.fromEntries(result.cases.map((entry) => [entry.key, entry]));
    const actions = byKey['src/Actions.tsx|Actions#0/0'];
    expect(actions.plan.evidence).toContain('COMPONENT_SHAPE_LEARNED');
    expect(actions.plan.standIns).toBeUndefined();
    expect(actions.category).toBe('equal');
    expect(byKey['src/Actions.tsx|Thumb#0/0'].category).toBe('equal');
    const footer = byKey['src/Actions.tsx|Footer#0/0'];
    expect(footer.category).toBe('difference');
    expect(
      footer.result.rootCauses.map((cause) => [cause.property, cause.before, cause.after]),
    ).toContainEqual(['min-block-size', '44px', '40px']);
    const stored = JSON.parse(await readFile(path.join(result.runDir, 'shapes.json'), 'utf8'));
    expect(Object.values(stored.shapes)).toContainEqual({
      base: expect.objectContaining({ root: 'button' }),
      head: expect.objectContaining({ className: { path: [], tag: 'button' }, root: 'button' }),
    });
  }, 240_000);
});

import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveScope } from './scope';

let repo: string;
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const write = async (file: string, content: string) => {
  await mkdir(path.dirname(path.join(repo, file)), { recursive: true });
  await writeFile(path.join(repo, file), content);
};

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'style-eq-scope-'));
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  await write(
    'src/features/List/style.ts',
    'export const styles = createStaticStyles(() => ({ a: css`color: red;` }));\n',
  );
  await write(
    'src/features/List/Item.tsx',
    "import { styles } from './style';\nexport const Item = () => <div className={styles.a} />;\n",
  );
  await write(
    'src/features/Other/Uses.tsx',
    "import { styles } from '@/features/List/style';\nexport const Uses = () => <i className={styles.a} />;\n",
  );
  await write('src/features/Other/Unrelated.tsx', 'export const Unrelated = () => <b />;\n');
  await write(
    'src/features/Card/Card.tsx',
    'export const Card = () => <section className="card">a long enough body to keep rename detection stable</section>;\n',
  );
  await write('src/features/Card/card.css', '.card { padding: 4px; }\n');
  await write(
    'src/features/Card/Uses.tsx',
    'import \'./card.css\';\nexport const C = () => <div className="card" />;\n',
  );
  git('add', '.');
  git('commit', '-qm', 'base');
});

afterEach(async () => {
  await rm(repo, { force: true, recursive: true });
});

describe('resolveScope', () => {
  it('pulls in unchanged components that import a changed style module', async () => {
    await write(
      'src/features/List/style.ts',
      "export const styles = stylex.create({ a: { color: 'red' } });\n",
    );
    await write('src/features/Card/card.css', '.card { padding: 6px; }\n');
    git('commit', '-qam', 'head');
    const scope = await resolveScope({ base: 'HEAD~1', head: 'HEAD', repo });
    expect(scope.files).toEqual([
      {
        base: 'src/features/Card/Uses.tsx',
        head: 'src/features/Card/Uses.tsx',
        reason: 'imports-changed-style',
      },
      {
        base: 'src/features/List/Item.tsx',
        head: 'src/features/List/Item.tsx',
        reason: 'imports-changed-style',
      },
      {
        base: 'src/features/Other/Uses.tsx',
        head: 'src/features/Other/Uses.tsx',
        reason: 'imports-changed-style',
      },
    ]);
  });

  it('pulls in components that import a changed index module through its directory', async () => {
    const factory = (color: string) =>
      `export const styles = createStaticStyles(() => ({ a: css\`color: ${color};\` }));\n`;
    await write('src/features/Panel/styles/index.ts', factory('red'));
    await write(
      'src/features/Panel/Panel.tsx',
      "import { styles } from './styles';\nexport const Panel = () => <div className={styles.a} />;\n",
    );
    await write(
      'src/features/Panel/styles/Inner.tsx',
      "import { styles } from '.';\nexport const Inner = () => <div className={styles.a} />;\n",
    );
    git('add', '.');
    git('commit', '-qm', 'panel');
    await write('src/features/Panel/styles/index.ts', factory('blue'));
    git('commit', '-qam', 'head');
    const scope = await resolveScope({ base: 'HEAD~1', head: 'HEAD', repo });
    expect(scope.files).toEqual([
      {
        base: 'src/features/Panel/Panel.tsx',
        head: 'src/features/Panel/Panel.tsx',
        reason: 'imports-changed-style',
      },
      {
        base: 'src/features/Panel/styles/Inner.tsx',
        head: 'src/features/Panel/styles/Inner.tsx',
        reason: 'imports-changed-style',
      },
    ]);
  });

  it('pairs a moved component by rename and keeps added and deleted files one-sided', async () => {
    git('mv', 'src/features/Card/Card.tsx', 'src/features/Card/CardView.tsx');
    await write('src/features/New/Fresh.tsx', 'export const Fresh = () => <p />;\n');
    git('rm', '-q', 'src/features/Other/Unrelated.tsx');
    git('add', '.');
    git('commit', '-qm', 'head');
    const scope = await resolveScope({ base: 'HEAD~1', head: 'HEAD', repo });
    expect(scope.files).toEqual([
      {
        base: 'src/features/Card/Card.tsx',
        head: 'src/features/Card/CardView.tsx',
        reason: 'renamed',
      },
      { head: 'src/features/New/Fresh.tsx', reason: 'added' },
      { base: 'src/features/Other/Unrelated.tsx', reason: 'deleted' },
    ]);
  });
});

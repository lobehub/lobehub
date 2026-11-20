import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Browser } from '@playwright/test';

import { type CaseRecord, runComparison } from '../../run';
import type { CorpusResult } from '../run';
import { SOURCE_CORPUS, type SourceCorpusEntry } from './entries';

export const CORPUS_DIR = 'src/__style_equivalence_corpus__';

const IDENTITY = {
  GIT_AUTHOR_EMAIL: 'style-equivalence@localhost',
  GIT_AUTHOR_NAME: 'style-equivalence',
  GIT_COMMITTER_EMAIL: 'style-equivalence@localhost',
  GIT_COMMITTER_NAME: 'style-equivalence',
};

const commitFiles = async (
  repo: string,
  parent: string,
  tree: string,
  files: Record<string, string>,
  message: string,
) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'style-eq-index-'));
  const env = { ...process.env, ...IDENTITY, GIT_INDEX_FILE: path.join(scratch, 'index') };
  const git = (args: string[], input?: string) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env, input }).trim();
  try {
    git(['read-tree', tree]);
    for (const [file, content] of Object.entries(files)) {
      const blob = git(['hash-object', '-w', '--stdin'], content);
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`]);
    }
    return git(['commit-tree', git(['write-tree']), '-p', parent, '-m', message]);
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
};

const filesOf = (entries: SourceCorpusEntry[], side: 'base' | 'head') =>
  Object.fromEntries(
    entries.flatMap((entry) =>
      Object.entries(entry[side]).map(([file, content]) => [
        `${CORPUS_DIR}/${entry.id}/${file}`,
        content,
      ]),
    ),
  );

const outcomeOfEntry = (cases: CaseRecord[], unpaired: number): CorpusResult['actual'] => {
  if (!cases.length && !unpaired) return 'error';
  if (cases.some((entry) => entry.category === 'blocking')) return 'error';
  if (cases.some((entry) => entry.category === 'difference' && !entry.plan.flags.length))
    return 'changed';
  if (unpaired || cases.some((entry) => entry.category !== 'equal')) return 'flagged';
  return 'equivalent';
};

export interface SourceCorpusOptions {
  browser?: Browser;
  configFile: string;
  only?: string[];
  recordsDir: string;
  repo: string;
}

export const runSourceCorpus = async ({
  browser,
  configFile,
  only,
  recordsDir,
  repo,
}: SourceCorpusOptions): Promise<CorpusResult[]> => {
  const entries = SOURCE_CORPUS.filter((entry) => !only || only.includes(entry.id));
  const parent = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const base = await commitFiles(repo, parent, parent, filesOf(entries, 'base'), 'corpus base');
  const head = await commitFiles(repo, base, parent, filesOf(entries, 'head'), 'corpus head');
  const result = await runComparison({
    base,
    browser,
    calibrate: false,
    configFile,
    head,
    mutations: 0,
    recordsDir,
    repo,
  });
  return entries.map((entry) => {
    const directory = `${CORPUS_DIR}/${entry.id}/`;
    const cases = result.cases.filter((item) => item.plan.file.startsWith(directory));
    const unpaired = result.plans
      .filter((plan) => plan.file.startsWith(directory))
      .reduce((total, plan) => total + plan.unpaired.length, 0);
    const actual = outcomeOfEntry(cases, unpaired);
    return {
      actual,
      detail: cases
        .filter((item) => item.category !== 'equal')
        .map(
          (item) =>
            `${item.key} ${item.category}${item.plan.flags.length ? ` [${item.plan.flags.join(',')}]` : ''} ${item.result.errors.join(';')}`,
        ),
      expected: entry.expected,
      feature: entry.feature,
      id: entry.id,
      passed: actual === entry.expected,
    };
  });
};

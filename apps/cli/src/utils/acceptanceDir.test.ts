import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ACCEPTANCE_DIR,
  acceptanceRoundDir,
  acceptanceRoundDirName,
  acceptanceSubjectKey,
  ensureAcceptanceDirIgnored,
  ensureAcceptanceDirIgnoredFor,
} from './acceptanceDir';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'acceptance-dir-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const gitInit = (dir: string) => execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });

const gitStatus = (dir: string) =>
  execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString();

describe('ensureAcceptanceDirIgnored', () => {
  it('ignores the whole tree from inside it, leaving the root .gitignore alone', () => {
    gitInit(root);
    writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');

    expect(ensureAcceptanceDirIgnored(root)).toMatchObject({ kind: 'added' });

    expect(readFileSync(path.join(root, ACCEPTANCE_DIR, '.gitignore'), 'utf8')).toBe('*\n');
    // The project's own file is not ours to rewrite.
    expect(readFileSync(path.join(root, '.gitignore'), 'utf8')).toBe('node_modules\n');
  });

  it('hides a written round from git, including the ignore file itself', () => {
    gitInit(root);
    ensureAcceptanceDirIgnored(root);

    const round = path.join(root, ACCEPTANCE_DIR, 'topic-tpc_x', '20260831-010203-first');
    mkdirSync(path.join(round, 'assets'), { recursive: true });
    writeFileSync(path.join(round, 'result.json'), '{}');
    writeFileSync(path.join(round, 'assets', 'shot.png'), 'binary');

    // Nothing from the tree — not the evidence, not the .gitignore we wrote.
    expect(gitStatus(root)).toBe('');
  });

  it('leaves an existing ignore file alone', () => {
    gitInit(root);
    mkdirSync(path.join(root, ACCEPTANCE_DIR), { recursive: true });
    writeFileSync(path.join(root, ACCEPTANCE_DIR, '.gitignore'), '/assets/\n');

    expect(ensureAcceptanceDirIgnored(root)).toEqual({ kind: 'present' });
    expect(readFileSync(path.join(root, ACCEPTANCE_DIR, '.gitignore'), 'utf8')).toBe('/assets/\n');
  });

  it('creates nothing outside a git repository', () => {
    expect(ensureAcceptanceDirIgnored(root)).toMatchObject({ kind: 'skipped' });
    expect(existsSync(path.join(root, ACCEPTANCE_DIR))).toBe(false);
  });
});

describe('ensureAcceptanceDirIgnoredFor', () => {
  it('seeds the tree a round directory belongs to', () => {
    gitInit(root);

    const round = path.join(root, ACCEPTANCE_DIR, 'task-T-12', '20260831-010203-round');
    expect(ensureAcceptanceDirIgnoredFor(round)).toMatchObject({ kind: 'added' });
    expect(existsSync(path.join(root, ACCEPTANCE_DIR, '.gitignore'))).toBe(true);
  });

  it('never creates the directory for a round kept somewhere else', () => {
    gitInit(root);

    expect(ensureAcceptanceDirIgnoredFor(path.join(root, 'my-reports', 'round'))).toMatchObject({
      kind: 'skipped',
    });
    expect(existsSync(path.join(root, ACCEPTANCE_DIR))).toBe(false);
  });
});

describe('acceptanceSubjectKey', () => {
  it('mirrors the --subject vocabulary as a directory name', () => {
    expect(acceptanceSubjectKey('topic:tpc_q11dU2Erfsjp')).toBe('topic-tpc_q11dU2Erfsjp');
    expect(acceptanceSubjectKey('task:T-12')).toBe('task-T-12');
    expect(acceptanceSubjectKey('document:doc_9')).toBe('document-doc_9');
  });

  it('keeps a bare subject usable as a directory name', () => {
    expect(acceptanceSubjectKey('standalone')).toBe('standalone');
  });
});

describe('acceptanceRoundDirName', () => {
  const at = new Date(2026, 7, 31, 1, 2, 3);

  it('sorts by time and stays unique per round', () => {
    expect(acceptanceRoundDirName('list panel', at)).toBe('20260831-010203-list-panel');
  });

  it('normalizes a slug down to path-safe characters', () => {
    expect(acceptanceRoundDirName('  Round #2: 验收 ', at)).toBe('20260831-010203-round-2');
  });

  it('still names the round when the slug reduces to nothing', () => {
    expect(acceptanceRoundDirName('验收', at)).toBe('20260831-010203');
  });

  it('places a round under its subject group', () => {
    expect(acceptanceRoundDir(root, 'topic:tpc_x', 'first', at)).toBe(
      path.join(root, ACCEPTANCE_DIR, 'topic-tpc_x', '20260831-010203-first'),
    );
  });

  it('never hands out a directory that already exists', () => {
    // Two rounds started in the same second — parallel workers, or a fast
    // fix-and-reverify. Sharing a name would let the second writer mix its
    // evidence into a round the reviewer has already been shown.
    const first = acceptanceRoundDir(root, 'topic:tpc_x', 'first', at);
    mkdirSync(first, { recursive: true });

    const second = acceptanceRoundDir(root, 'topic:tpc_x', 'first', at);
    expect(second).not.toBe(first);
    expect(second).toBe(`${first}-2`);

    mkdirSync(second, { recursive: true });
    expect(acceptanceRoundDir(root, 'topic:tpc_x', 'first', at)).toBe(`${first}-3`);
  });
});

import { lstat, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  adoptSwarmLane,
  prepareSwarmLane,
  promoteSwarmLane,
  readSwarmOwner,
  snapshotSwarmLaneBest,
  stakeSwarmLanes,
  swarmLaneBestDirectory,
} from './swarmLane';

const workspace = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lh-swarm-'));
  await writeFile(path.join(root, 'train.py'), 'v0');
  await mkdir(path.join(root, 'data'));
  await writeFile(path.join(root, 'data', 'logs.csv'), 'rows');
  return root;
};

const read = (file: string) => readFile(file, 'utf8');

describe('prepareSwarmLane', () => {
  it("copies the workspace into a lane's directory on its first run, without .lanes", async () => {
    const root = await workspace();
    const laneA = path.join(root, '.lanes', 'A');
    expect(await prepareSwarmLane(laneA)).toBe(laneA);
    expect(await read(path.join(laneA, 'train.py'))).toBe('v0');
    expect(await read(path.join(laneA, 'data', 'logs.csv'))).toBe('rows');

    // Lane B is copied after A exists: it must not nest A inside itself.
    const laneB = path.join(root, '.lanes', 'B');
    await prepareSwarmLane(laneB);
    await expect(read(path.join(laneB, '.lanes', 'A', 'train.py'))).rejects.toThrow();
  });

  it('leaves an existing lane and any non-lane directory alone', async () => {
    const root = await workspace();
    const laneA = path.join(root, '.lanes', 'A');
    await prepareSwarmLane(laneA);
    await writeFile(path.join(laneA, 'train.py'), 'lane work');
    await prepareSwarmLane(laneA);
    expect(await read(path.join(laneA, 'train.py'))).toBe('lane work');
    expect(await prepareSwarmLane(root)).toBe(root);
  });
});

describe('adopt and promote', () => {
  it("adopts another lane's files and keeps the adopting lane's own as a snapshot", async () => {
    const root = await workspace();
    const [laneA, laneB] = ['A', 'B'].map((key) => path.join(root, '.lanes', key));
    await prepareSwarmLane(laneA);
    await prepareSwarmLane(laneB);
    await writeFile(path.join(laneA, 'train.py'), 'A wins');
    await writeFile(path.join(laneB, 'train.py'), 'B try');

    const { snapshot } = await adoptSwarmLane(path.join(laneB, 'data'), 'A');

    expect(await read(path.join(laneB, 'train.py'))).toBe('A wins');
    expect(await read(path.join(snapshot, 'train.py'))).toBe('B try');
    await expect(adoptSwarmLane(laneA, 'A')).rejects.toThrow(/itself/);
    await expect(adoptSwarmLane(root, 'A')).rejects.toThrow(/inside a swarm lane/);
  });

  it('promotes the files a lane was graded on when it left worse ones behind', async () => {
    const root = await workspace();
    const laneA = path.join(root, '.lanes', 'A');
    await prepareSwarmLane(laneA);
    await writeFile(path.join(laneA, 'train.py'), 'graded');
    await snapshotSwarmLaneBest(laneA);

    // The deadline cut the lane mid-edit: its current files score below the record.
    await writeFile(path.join(laneA, 'train.py'), 'half-finished');

    const promoted = await promoteSwarmLane(root, 'A');

    expect(promoted.graded).toBe(true);
    expect(await read(path.join(root, 'train.py'))).toBe('graded');
    expect(await read(path.join(swarmLaneBestDirectory(root, 'A'), 'train.py'))).toBe('graded');
    // The lane keeps the work it was in the middle of.
    expect(await read(path.join(laneA, 'train.py'))).toBe('half-finished');
    // The archive of the lanes is bookkeeping: it is not copied into the workspace.
    await expect(read(path.join(root, '.lanes', 'A', 'train.py'))).resolves.toBe('half-finished');
  });

  it('replaces the snapshot when the same lane takes the lead a second time', async () => {
    const root = await workspace();
    const laneA = path.join(root, '.lanes', 'A');
    await prepareSwarmLane(laneA);
    await writeFile(path.join(laneA, 'train.py'), 'first best');
    await snapshotSwarmLaneBest(laneA);

    await writeFile(path.join(laneA, 'train.py'), 'second best');
    await snapshotSwarmLaneBest(laneA);

    expect(await read(path.join(swarmLaneBestDirectory(root, 'A'), 'train.py'))).toBe(
      'second best',
    );
    // Serving the later score means promoting its files, not the first best's.
    expect((await promoteSwarmLane(root, 'A')).graded).toBe(true);
    expect(await read(path.join(root, 'train.py'))).toBe('second best');
    // Neither the staging copy nor the retired one is left next to the snapshots.
    expect(await readdir(path.join(root, '.lanes', '_best'))).toEqual(['A']);
  });

  it('promotes a lane over the workspace, keeping the old workspace and the lanes', async () => {
    const root = await workspace();
    const laneA = path.join(root, '.lanes', 'A');
    await prepareSwarmLane(laneA);
    await writeFile(path.join(laneA, 'train.py'), 'champion');

    const { graded, snapshot } = await promoteSwarmLane(root, 'A');

    expect(graded).toBe(false);
    expect(await read(path.join(root, 'train.py'))).toBe('champion');
    expect(await read(path.join(snapshot, 'train.py'))).toBe('v0');
    expect(await read(path.join(laneA, 'train.py'))).toBe('champion');
    await expect(promoteSwarmLane(root, 'Z')).rejects.toThrow(/no directory/);
  });
});

describe('stakeSwarmLanes', () => {
  it('claims .lanes for one swarm and keeps the lanes of that same swarm', async () => {
    const root = await workspace();
    await stakeSwarmLanes(root, 'goal-1');
    expect(await readSwarmOwner(root)).toBe('goal-1');
    await prepareSwarmLane(path.join(root, '.lanes', 'A'));
    await writeFile(path.join(root, '.lanes', 'A', 'train.py'), 'first swarm work');

    // A retry of the same swarm keeps what its lanes already did.
    await stakeSwarmLanes(root, 'goal-1');
    expect(await read(path.join(root, '.lanes', 'A', 'train.py'))).toBe('first swarm work');
  });

  it("moves an earlier swarm's lanes aside so the new swarm starts from the workspace", async () => {
    const root = await workspace();
    await stakeSwarmLanes(root, 'goal-1');
    await prepareSwarmLane(path.join(root, '.lanes', 'A'));
    await writeFile(path.join(root, '.lanes', 'A', 'train.py'), 'first swarm work');
    await writeFile(path.join(root, 'train.py'), 'workspace moved on');

    await stakeSwarmLanes(root, 'goal-2');

    expect(await readSwarmOwner(root)).toBe('goal-2');
    await expect(read(path.join(root, '.lanes', 'A', 'train.py'))).rejects.toThrow();
    expect(await read(path.join(root, '.lanes-goal-1', 'A', 'train.py'))).toBe('first swarm work');

    // A fresh lane copies the workspace, not the archived copies of the old swarm.
    const laneB = path.join(root, '.lanes', 'A');
    await prepareSwarmLane(laneB);
    expect(await read(path.join(laneB, 'train.py'))).toBe('workspace moved on');
    await expect(read(path.join(laneB, '.lanes-goal-1', 'A', 'train.py'))).rejects.toThrow();
  });

  it('skips a workspace that is not on this machine', async () => {
    const root = await workspace();
    expect(await stakeSwarmLanes(path.join(root, 'missing'), 'goal-1')).toBeUndefined();
  });
});

describe('prepareSwarmLane on a linked worktree', () => {
  /** A workspace whose `.git` is a pointer file, next to the repository it borrows from. */
  const linkedWorktree = async (options: { config?: string } = {}) => {
    const root = await mkdtemp(path.join(tmpdir(), 'lh-swarm-wt-'));
    const shared = path.join(root, 'repo', '.git');
    const worktreeGit = path.join(shared, 'worktrees', 'wt');
    await mkdir(path.join(shared, 'objects'), { recursive: true });
    await writeFile(path.join(shared, 'objects', 'pack-1.pack'), 'objects');
    await mkdir(path.join(shared, 'refs', 'heads'), { recursive: true });
    await writeFile(path.join(shared, 'refs', 'heads', 'main'), 'sha-main\n');
    await writeFile(path.join(shared, 'config'), options.config ?? '[core]\n');
    await writeFile(path.join(shared, 'index'), 'original-index');
    await mkdir(worktreeGit, { recursive: true });
    await writeFile(path.join(worktreeGit, 'commondir'), '../..\n');
    await writeFile(path.join(worktreeGit, 'gitdir'), path.join(root, 'worktree', '.git'));
    await writeFile(path.join(worktreeGit, 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(path.join(worktreeGit, 'index'), 'worktree-index');

    const worktree = path.join(root, 'worktree');
    await mkdir(worktree, { recursive: true });
    await writeFile(path.join(worktree, '.git'), `gitdir: ${worktreeGit}\n`);
    await writeFile(path.join(worktree, 'train.py'), 'v0');
    return { shared, worktree, worktreeGit };
  };

  it('gives the copy its own gitdir instead of a pointer back to the shared one', async () => {
    const { worktree, worktreeGit } = await linkedWorktree();
    const lane = path.join(worktree, '.lanes', 'A');
    await prepareSwarmLane(lane);

    const gitDir = path.join(lane, '.git');
    expect((await lstat(gitDir)).isDirectory()).toBe(true);
    // The worktree's own state, not the main checkout's.
    expect(await read(path.join(gitDir, 'HEAD'))).toBe('ref: refs/heads/main\n');
    expect(await read(path.join(gitDir, 'index'))).toBe('worktree-index');
    // The parts it borrows from the shared repository.
    expect(await read(path.join(gitDir, 'objects', 'pack-1.pack'))).toBe('objects');
    expect(await read(path.join(gitDir, 'refs', 'heads', 'main'))).toBe('sha-main\n');
    expect(await read(path.join(gitDir, 'config'))).toBe('[core]\n');
    // Nothing in the copy still resolves to the shared gitdir.
    await expect(read(path.join(gitDir, 'commondir'))).rejects.toThrow();
    await expect(read(path.join(gitDir, 'gitdir'))).rejects.toThrow();

    // The original workspace keeps its pointer.
    expect(await read(path.join(worktree, '.git'))).toBe(`gitdir: ${worktreeGit}\n`);
  });

  it('marks the copy as a working tree when the shared repository is bare', async () => {
    const { worktree } = await linkedWorktree({ config: '[core]\n\tbare = true\n' });
    const lane = path.join(worktree, '.lanes', 'A');
    await prepareSwarmLane(lane);

    // A bare repository's config would make every `git status`/`add` in the lane fail with
    // "this operation must be run in a work tree".
    expect(await read(path.join(lane, '.git', 'config'))).toBe('[core]\n\tbare = false\n');
  });

  it("keeps the workspace's own git metadata when a lane is promoted over it", async () => {
    const { worktree, worktreeGit } = await linkedWorktree();
    const lane = path.join(worktree, '.lanes', 'A');
    await prepareSwarmLane(lane);
    await writeFile(path.join(lane, 'train.py'), 'champion');

    await promoteSwarmLane(worktree, 'A');

    expect(await read(path.join(worktree, 'train.py'))).toBe('champion');
    // The workspace stays a linked worktree: its pointer is untouched, and the parent
    // repository keeps this worktree's registration instead of gaining a stray repository.
    expect(await read(path.join(worktree, '.git'))).toBe(`gitdir: ${worktreeGit}\n`);
    expect((await lstat(path.join(lane, '.git'))).isDirectory()).toBe(true);
  });

  it('keeps a plain repository copy as its own .git directory', async () => {
    const root = await workspace();
    await mkdir(path.join(root, '.git'));
    await writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    const lane = path.join(root, '.lanes', 'A');
    await prepareSwarmLane(lane);

    expect((await lstat(path.join(lane, '.git'))).isDirectory()).toBe(true);
    expect(await read(path.join(lane, '.git', 'HEAD'))).toBe('ref: refs/heads/main\n');
  });
});

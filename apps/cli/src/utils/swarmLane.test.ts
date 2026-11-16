import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { adoptSwarmLane, prepareSwarmLane, promoteSwarmLane } from './swarmLane';

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

  it('promotes a lane over the workspace, keeping the old workspace and the lanes', async () => {
    const root = await workspace();
    const laneA = path.join(root, '.lanes', 'A');
    await prepareSwarmLane(laneA);
    await writeFile(path.join(laneA, 'train.py'), 'champion');

    const { snapshot } = await promoteSwarmLane(root, 'A');

    expect(await read(path.join(root, 'train.py'))).toBe('champion');
    expect(await read(path.join(snapshot, 'train.py'))).toBe('v0');
    expect(await read(path.join(laneA, 'train.py'))).toBe('champion');
    await expect(promoteSwarmLane(root, 'Z')).rejects.toThrow(/no directory/);
  });
});

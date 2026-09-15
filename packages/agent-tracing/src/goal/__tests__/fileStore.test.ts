import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileGoalTraceStore } from '../store/file-store';
import type { GoalTrajectory } from '../types';
import { graph, node } from './fixtures';

const trajectory = (goalId: string, title: string): GoalTrajectory => ({
  advances: [],
  goalId,
  graphBaseline: graph({ nodes: [node('a')] }),
  startedAt: 0,
  title,
  totalAdvances: 0,
  totalTicks: 0,
  traceId: goalId,
});

describe('FileGoalTraceStore.list', () => {
  let rootDir: string;
  let store: FileGoalTraceStore;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-store-'));
    store = new FileGoalTraceStore(rootDir);
  });

  afterEach(async () => {
    await fs.rm(rootDir, { force: true, recursive: true });
  });

  it('lists goals that are still running, not only finished ones', async () => {
    // A long-horizon goal is a partial for nearly all of its life, so a listing
    // that showed only finalized objects would report an empty directory on a
    // machine that is actively running goals.
    await store.savePartial('goal_running', {
      advances: [],
      goalId: 'goal_running',
      startedAt: 5,
      title: 'Still going',
    });

    expect(await store.list()).toMatchObject([
      { completionReason: undefined, goalId: 'goal_running', title: 'Still going' },
    ]);
  });

  it('shows a goal once when a stale partial outlived its finalized object', async () => {
    await store.savePartial('goal_1', { advances: [], goalId: 'goal_1', title: 'Partial copy' });
    await store.save({ ...trajectory('goal_1', 'Finalized copy'), completionReason: 'achieved' });

    const listed = await store.list();

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ completionReason: 'achieved', title: 'Finalized copy' });
  });

  it('applies the limit across both kinds', async () => {
    await store.save(trajectory('goal_done', 'Done'));
    await store.savePartial('goal_open', { advances: [], goalId: 'goal_open', title: 'Open' });

    expect(await store.list({ limit: 1 })).toHaveLength(1);
    expect(await store.list()).toHaveLength(2);
  });
});

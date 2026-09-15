import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileGoalTraceStore } from '../store/file-store';
import { loadGoalTrajectory } from '../store/loadTrajectory';
import type { GoalTrajectory } from '../types';
import { graph, node } from './fixtures';

const trajectory = (goalId: string): GoalTrajectory => ({
  advances: [],
  goalId,
  graphBaseline: graph({ nodes: [node('a')] }),
  startedAt: 0,
  title: 'Reproduce nanoGPT',
  totalAdvances: 0,
  totalTicks: 0,
  traceId: goalId,
});

describe('loadGoalTrajectory', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-trace-'));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { force: true, recursive: true });
  });

  it('reads a local trajectory without asking the server', async () => {
    await new FileGoalTraceStore(rootDir).save(trajectory('goal_1'));
    const resolveDownloadUrl = vi.fn();

    const loaded = await loadGoalTrajectory('goal_1', {
      allowDownload: true,
      resolveDownloadUrl,
      rootDir,
    });

    expect(loaded?.goalId).toBe('goal_1');
    expect(resolveDownloadUrl).not.toHaveBeenCalled();
  });

  it('serves an in-flight goal from its partial', async () => {
    await new FileGoalTraceStore(rootDir).savePartial('goal_2', {
      advances: [],
      goalId: 'goal_2',
      startedAt: 5,
      title: 'Still running',
    });

    const loaded = await loadGoalTrajectory('goal_2', { rootDir });

    expect(loaded).toMatchObject({ goalId: 'goal_2', title: 'Still running' });
  });

  it('does not reach the network unless downloading is allowed', async () => {
    const resolveDownloadUrl = vi.fn();

    expect(
      await loadGoalTrajectory('goal_missing', { resolveDownloadUrl, rootDir }),
    ).toBeUndefined();
    expect(resolveDownloadUrl).not.toHaveBeenCalled();
  });

  it('gives up quietly when the server has nothing to sign', async () => {
    const resolveDownloadUrl = vi.fn().mockResolvedValue(null);

    const loaded = await loadGoalTrajectory('goal_missing', {
      allowDownload: true,
      resolveDownloadUrl,
      rootDir,
    });

    expect(loaded).toBeUndefined();
    expect(resolveDownloadUrl).toHaveBeenCalledWith('goal_missing');
  });

  it('re-fetches an unfinished goal instead of serving a stale cached copy', async () => {
    // A running goal is a moving object; a cache hit would pin the reader to
    // whatever it looked like the first time it was inspected.
    const cacheDir = path.join(rootDir, '.goal-tracing', '_remote');
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      path.join(cacheDir, 'goal_running.json'),
      JSON.stringify({ ...trajectory('goal_running'), advances: [] }),
      'utf8',
    );
    const resolveDownloadUrl = vi.fn().mockResolvedValue(null);

    await loadGoalTrajectory('goal_running', { allowDownload: true, resolveDownloadUrl, rootDir });

    expect(resolveDownloadUrl).toHaveBeenCalledWith('goal_running');
  });

  it('serves a finished goal from cache without asking the server again', async () => {
    const cacheDir = path.join(rootDir, '.goal-tracing', '_remote');
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      path.join(cacheDir, 'goal_done.json'),
      JSON.stringify({ ...trajectory('goal_done'), completionReason: 'achieved' }),
      'utf8',
    );
    const resolveDownloadUrl = vi.fn();

    const loaded = await loadGoalTrajectory('goal_done', {
      allowDownload: true,
      resolveDownloadUrl,
      rootDir,
    });

    expect(loaded?.completionReason).toBe('achieved');
    expect(resolveDownloadUrl).not.toHaveBeenCalled();
  });

  it('reads a trajectory straight off a json path', async () => {
    const filePath = path.join(rootDir, 'exported.json');
    await fs.writeFile(filePath, JSON.stringify(trajectory('goal_3')), 'utf8');

    expect((await loadGoalTrajectory(filePath))?.goalId).toBe('goal_3');
  });
});

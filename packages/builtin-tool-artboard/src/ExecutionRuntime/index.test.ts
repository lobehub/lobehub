import { describe, expect, it, vi } from 'vitest';

import type { ArtboardToolService, ArtboardToolSnapshot } from '../types';
import { ArtboardExecutionRuntime } from './index';

const snapshot = (overrides: Partial<ArtboardToolSnapshot> = {}): ArtboardToolSnapshot => ({
  content: {
    arrows: [],
    frames: [
      {
        groupId: 'g1',
        id: 'f1',
        source: { canvasId: 'cvs_1', kind: 'canvas', version: 2 },
        title: '空项目',
        x: 0,
        y: 0,
      },
    ],
    groups: [{ desc: '', id: 'g1', kind: 'journey', title: '旅程' }],
    notes: [],
  },
  description: '首次进入',
  id: 'art_1',
  phase: 'discuss',
  projectId: 'prj_1',
  revision: 1,
  taskId: 'task_1',
  title: '新用户首次进入项目',
  ...overrides,
});

const service = (overrides: Partial<ArtboardToolService> = {}): ArtboardToolService => ({
  create: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
  ...overrides,
});

describe('ArtboardExecutionRuntime', () => {
  it('reports the new board in state and asks for its Work', async () => {
    const create = vi.fn().mockResolvedValue({
      artboard: snapshot(),
      changedIds: ['g1', 'f1'],
      ok: true,
      task: { createdTask: true, identifier: 'PRJ-3' },
    });
    const onWorkRegistration = vi.fn();
    const result = await new ArtboardExecutionRuntime(service({ create })).createArtboard(
      { title: '新用户首次进入项目' },
      { onWorkRegistration },
    );

    expect(result.success).toBe(true);
    expect(result.state).toEqual({
      artboardId: 'art_1',
      changedIds: ['g1', 'f1'],
      frameCount: 1,
      groupCount: 1,
      phase: 'discuss',
      revision: 1,
      title: '新用户首次进入项目',
    });
    expect(result.content).toContain('art_1');
    expect(result.content).toContain('PRJ-3');
    expect(onWorkRegistration).toHaveBeenCalledWith({
      action: 'register',
      artboard: {
        artboardId: 'art_1',
        changeType: 'created',
        description: '首次进入',
        projectId: 'prj_1',
        title: '新用户首次进入项目',
        toolName: 'createArtboard',
      },
      type: 'artboard',
    });
  });

  it('turns a stale revision into a hint to read again, and registers nothing', async () => {
    const update = vi.fn().mockResolvedValue({
      code: 'conflict',
      message: 'The board changed since you read it.',
      ok: false,
    });
    const onWorkRegistration = vi.fn();
    const result = await new ArtboardExecutionRuntime(service({ update })).updateArtboard(
      { id: 'art_1', ops: [], revision: 1 },
      { onWorkRegistration },
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain('readArtboard');
    expect(result.error).toMatchObject({ type: 'conflict' });
    expect(onWorkRegistration).not.toHaveBeenCalled();
  });

  it('keeps routine updates out of the Work history', async () => {
    const update = vi.fn().mockResolvedValue({
      artboard: snapshot({ revision: 2 }),
      changedIds: ['f1'],
      ok: true,
    });
    const onWorkRegistration = vi.fn();
    const result = await new ArtboardExecutionRuntime(service({ update })).updateArtboard(
      { id: 'art_1', ops: [{ id: 'f1', patch: { x: 10 }, type: 'updateFrame' }], revision: 1 },
      { onWorkRegistration },
    );

    expect(result.state).toMatchObject({ changedIds: ['f1'], revision: 2 });
    expect(onWorkRegistration).not.toHaveBeenCalled();
  });

  it('reads the board with the frames behind their Canvas', async () => {
    const read = vi.fn().mockResolvedValue({
      artboard: snapshot(),
      canvases: { cvs_1: { latestVersion: 3, title: '空项目' } },
      ok: true,
      staleFrameIds: ['f1'],
    });
    const result = await new ArtboardExecutionRuntime(service({ read })).readArtboard({
      id: 'art_1',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('revision 1');
    expect(result.content).toContain('f1 shows Canvas cvs_1 v2, latest is v3');
  });
});

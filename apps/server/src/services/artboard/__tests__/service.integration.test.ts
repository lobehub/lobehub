// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import type { ArtboardOp } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { acceptanceFlows, projects, tasks, topics, users } from '@/database/schemas';

import { ArtboardServiceError } from '../errors';
import { ArtboardService } from '../index';
import type { ArtboardSourceResolver } from '../sources';

const userId = 'artboard-service-user';
const projectId = 'prj_artboard_service';
const projectTopicId = 'tpc_artboard_project';
const looseTopicId = 'tpc_artboard_loose';

const db: LobeChatDatabase = await getTestDB();

const canvases: Record<string, { title: string; version: number }> = {
  cvs_a: { title: '空项目', version: 3 },
  cvs_b: { title: '接入资料', version: 1 },
};

const sources: ArtboardSourceResolver = {
  canvas: async (canvasId) => canvases[canvasId],
  image: async (fileRef) => (fileRef === 'msg_1.image_1' ? 'file_shot' : undefined),
  imageUrl: async (fileId) => `https://files.test/${fileId}`,
};

const service = () => new ArtboardService(db, userId, undefined, { sources });

const journeyOps = (): ArtboardOp[] => [
  { group: { kind: 'journey', title: '首次进入' }, ref: 'j', type: 'addGroup' },
  {
    frame: {
      groupId: 'j',
      source: { canvasId: 'cvs_a', kind: 'canvas' },
      title: '空项目',
      x: 0,
      y: 0,
    },
    ref: 'empty',
    type: 'addFrame',
  },
  {
    frame: {
      groupId: 'j',
      source: { canvasId: 'cvs_b', kind: 'canvas' },
      title: '接入资料',
      x: 720,
      y: 0,
    },
    ref: 'ingest',
    type: 'addFrame',
  },
  { arrow: { from: 'empty', label: '点接入', to: 'ingest' }, type: 'addArrow' },
];

const errorOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ArtboardServiceError) return error;
    throw error;
  }
  throw new Error('expected an ArtboardServiceError');
};

beforeEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  await db.insert(projects).values({ id: projectId, name: 'Onboarding', userId });
  await db.insert(topics).values([
    { id: projectTopicId, projectId, title: '需求讨论', userId },
    { id: looseTopicId, title: '随便聊聊', userId },
  ]);
});

afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

describe('ArtboardService.create', () => {
  it('uses the task passed in, and its project', async () => {
    const task = await new TaskModel(db, userId).create({ instruction: '首次进入', projectId });
    const result = await service().create(
      { ops: journeyOps(), taskId: task.identifier, title: '新用户首次进入项目' },
      { topicId: looseTopicId },
    );

    expect(result.artboard).toMatchObject({
      originTopicId: looseTopicId,
      phase: 'discuss',
      projectId,
      revision: 1,
      taskId: task.id,
    });
    expect(result.createdTask).toBe(false);
    expect(result.artboard.content.frames.map((f) => f.source)).toEqual([
      { canvasId: 'cvs_a', kind: 'canvas', version: 3 },
      { canvasId: 'cvs_b', kind: 'canvas', version: 1 },
    ]);
    expect(result.artboard.content.arrows).toEqual([
      { from: 'f1', id: 'a1', label: '点接入', to: 'f2' },
    ]);
  });

  it('falls back to the task of the running context', async () => {
    const task = await new TaskModel(db, userId).create({ instruction: '首次进入', projectId });
    const result = await service().create(
      { title: '画板' },
      { taskId: task.id, topicId: projectTopicId },
    );
    expect(result.artboard.taskId).toBe(task.id);
  });

  it('creates a task in the conversation’s project when none is given', async () => {
    const result = await service().create(
      { description: '讨论首次进入的流程', title: '首次进入' },
      { topicId: projectTopicId },
    );

    expect(result.createdTask).toBe(true);
    const [task] = await db.select().from(tasks).where(eq(tasks.id, result.artboard.taskId));
    expect(task).toMatchObject({ name: '首次进入', projectId });
  });

  it('refuses a board outside any project', async () => {
    const error = await errorOf(service().create({ title: '画板' }, { topicId: looseTopicId }));
    expect(error.code).toBe('no_project');
  });

  it('refuses a second board for one task and names the first', async () => {
    const task = await new TaskModel(db, userId).create({ instruction: 'x', projectId });
    const first = await service().create({ taskId: task.id, title: 'A' }, {});

    const error = await errorOf(service().create({ taskId: task.id, title: 'B' }, {}));
    expect(error.code).toBe('exists');
    expect(error.data.artboardId).toBe(first.artboard.id);
  });

  it('refuses a Canvas the user cannot open, and stores image refs as files', async () => {
    const denied = await errorOf(
      service().create(
        {
          ops: [
            { group: { kind: 'options', title: '方案' }, ref: 'o', type: 'addGroup' },
            {
              frame: {
                groupId: 'o',
                source: { canvasId: 'cvs_x', kind: 'canvas' },
                title: 'X',
                x: 0,
                y: 0,
              },
              type: 'addFrame',
            },
          ],
          title: '画板',
        },
        { topicId: projectTopicId },
      ),
    );
    expect(denied).toMatchObject({ code: 'source_denied', data: { opIndex: 1 } });

    const created = await service().create(
      {
        ops: [
          { group: { kind: 'references', title: '参考' }, ref: 'r', type: 'addGroup' },
          {
            frame: {
              groupId: 'r',
              source: { fileRef: 'msg_1.image_1', kind: 'image' },
              title: '截图',
              x: 0,
              y: 0,
            },
            type: 'addFrame',
          },
        ],
        title: '画板',
      },
      { topicId: projectTopicId },
    );
    expect(created.artboard.content.frames[0].source).toEqual({
      fileId: 'file_shot',
      kind: 'image',
    });
  });
});

describe('ArtboardService.update and read', () => {
  it('rejects a stale revision and flags frames behind their Canvas', async () => {
    const { artboard } = await service().create(
      { ops: journeyOps(), title: '画板' },
      { topicId: projectTopicId },
    );

    const updated = await service().update(artboard.id, 1, [
      { id: 'f1', patch: { title: '新的空项目' }, type: 'updateFrame' },
    ]);
    expect(updated).toMatchObject({ artboard: { revision: 2 }, changedIds: ['f1'] });

    const stale = await errorOf(
      service().update(artboard.id, 1, [{ id: 'f2', type: 'removeFrame' }]),
    );
    expect(stale.code).toBe('conflict');

    canvases.cvs_b = { title: '接入资料', version: 2 };
    const read = await service().read(artboard.id);
    expect(read.staleFrameIds).toEqual(['f2']);
    expect(read.canvases.cvs_b).toEqual({ latestVersion: 2, title: '接入资料' });
    canvases.cvs_b = { title: '接入资料', version: 1 };
  });
});

describe('ArtboardService.finalize', () => {
  it('lists what is missing before it will finalize', async () => {
    const { artboard } = await service().create(
      { ops: journeyOps(), title: '画板' },
      { topicId: projectTopicId },
    );
    const error = await errorOf(service().finalize(artboard.id, artboard.revision));
    expect(error.code).toBe('finalize_blocked');
    expect(error.data.issues).toEqual([
      { code: 'missing_check', frameId: 'f1' },
      { code: 'missing_check', frameId: 'f2' },
    ]);
  });

  it('publishes the journey as an acceptance flow once', async () => {
    const created = await service().create(
      {
        ops: [
          ...journeyOps(),
          { expected: '看到空状态', frameId: 'empty', type: 'setCheck' },
          { expected: '看到上传入口', frameId: 'ingest', type: 'setCheck' },
        ],
        title: '首次进入',
      },
      { topicId: projectTopicId },
    );

    const result = await service().finalize(created.artboard.id, created.artboard.revision);
    expect(result.artboard).toMatchObject({
      acceptanceId: result.acceptanceId,
      phase: 'finalized',
      revision: 2,
    });
    const [entry, next] = result.artboard.content.frames;
    expect(entry.flowNodeId).toMatch(/^[\da-f-]{36}$/);
    expect(next.flowNodeId).toMatch(/^[\da-f-]{36}$/);
    expect(result.artboard.content.arrows[0].flowEdgeId).toMatch(/^[\da-f-]{36}$/);

    const again = await service().finalize(created.artboard.id, 1);
    expect(again.acceptanceId).toBe(result.acceptanceId);
    expect(again.artboard.revision).toBe(2);
    const flows = await db
      .select()
      .from(acceptanceFlows)
      .where(eq(acceptanceFlows.acceptanceId, result.acceptanceId));
    expect(flows).toHaveLength(1);
  });
});

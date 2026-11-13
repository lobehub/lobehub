import type { ArtboardCommentThreadView } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { ArtboardToolService, ArtboardToolSnapshot } from '../types';
import { ArtboardExecutionRuntime } from './index';

const snapshot = (overrides: Partial<ArtboardToolSnapshot> = {}): ArtboardToolSnapshot => ({
  content: {
    boards: [
      {
        expected: '看到接入入口',
        flowNodeId: null,
        groupId: 'abg_1',
        id: 'brd-1',
        pageId: 'abp_1',
        rect: { h: 400, w: 640, x: 0, y: 0 },
        roundId: null,
        source: { canvasId: 'cvs_1', kind: 'canvas', version: 2 },
        title: '空项目',
        type: 'html',
      },
    ],
    edges: [],
    groups: [
      {
        desc: '',
        id: 'abg_1',
        kind: 'journey',
        pageId: 'abp_1',
        rect: { h: 592, w: 736, x: -48, y: -144 },
        title: '旅程',
      },
    ],
    pages: [{ id: 'abp_1', name: 'Page 1', sortOrder: 0 }],
    questions: [],
    rounds: [],
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
  askQuestion: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  listComments: vi.fn(),
  read: vi.fn(),
  replyComment: vi.fn(),
  resolveComment: vi.fn(),
  update: vi.fn(),
  ...overrides,
});

const thread = (overrides: Partial<ArtboardCommentThreadView> = {}): ArtboardCommentThreadView => ({
  anchor: null,
  authorAgentId: null,
  authorUserId: 'user_1',
  boardId: 'brd-1',
  content: '按钮太小了',
  createdAt: new Date('2026-11-13T00:00:00.000Z'),
  groupId: null,
  id: 'cmt-1',
  pageId: 'abp_1',
  replies: [],
  resolvedAt: null,
  ...overrides,
});

describe('ArtboardExecutionRuntime', () => {
  it('reports the new board in state and asks for its Work', async () => {
    const create = vi.fn().mockResolvedValue({
      artboard: snapshot(),
      changedIds: ['abg_1', 'brd-1'],
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
      boardCount: 1,
      changedIds: ['abg_1', 'brd-1'],
      groupCount: 1,
      phase: 'discuss',
      revision: 1,
      title: '新用户首次进入项目',
    });
    expect(result.content).toContain('art_1');
    expect(result.content).toContain('PRJ-3');
    expect(result.content).toContain('1 groups · 1 boards');
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
    const result = await new ArtboardExecutionRuntime(service({ update })).updateArtboard({
      id: 'art_1',
      ops: [],
      revision: 1,
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('readArtboard');
    expect(result.error).toMatchObject({ type: 'conflict' });
  });

  it('reports what an update changed', async () => {
    const update = vi.fn().mockResolvedValue({
      artboard: snapshot({ revision: 2 }),
      changedIds: ['brd-1'],
      ok: true,
    });
    const result = await new ArtboardExecutionRuntime(service({ update })).updateArtboard({
      id: 'art_1',
      ops: [{ id: 'brd-1', patch: { x: 10 }, type: 'updateBoard' }],
      revision: 1,
    });

    expect(result.state).toMatchObject({ boardCount: 1, changedIds: ['brd-1'], revision: 2 });
    expect(result.content).toContain('Changed: brd-1');
  });

  it('reads the board with the boards behind their Canvas', async () => {
    const read = vi.fn().mockResolvedValue({
      artboard: snapshot(),
      canvases: { cvs_1: { latestVersion: 3, title: '空项目' } },
      ok: true,
      staleBoardIds: ['brd-1'],
    });
    const result = await new ArtboardExecutionRuntime(service({ read })).readArtboard({
      id: 'art_1',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('revision 1');
    expect(result.content).toContain('- abp_1 "Page 1"');
    expect(result.content).toContain(
      '- brd-1 on abp_1 in abg_1 "空项目" at (0, 0) 640×400 canvas cvs_1 v2 check: 看到接入入口',
    );
    expect(result.content).toContain('brd-1 shows Canvas cvs_1 v2, latest is v3');
    expect(result.state).toMatchObject({ staleBoardIds: ['brd-1'] });
  });

  it('reads a round with its recommendation and the user’s choice, and a decision branch', async () => {
    const base = snapshot().content;
    const option = { ...base.boards[0], expected: null, groupId: 'abg_2', roundId: 'rnd-1' };
    const read = vi.fn().mockResolvedValue({
      artboard: snapshot({
        content: {
          ...base,
          boards: [
            base.boards[0],
            { ...option, id: 'opt-a', title: '方案 A' },
            { ...option, id: 'opt-b', title: '方案 B' },
            {
              ...base.boards[0],
              expected: null,
              id: 'dec-1',
              source: null,
              title: '已付费？',
              type: 'decision',
            },
          ],
          edges: [
            {
              condition: '已付费',
              flowEdgeId: null,
              from: 'dec-1',
              id: 'edg-1',
              isDefault: true,
              label: '点「继续」',
              to: 'brd-1',
            },
          ],
          questions: [
            {
              boardId: 'brd-1',
              content: '能跳过吗？',
              groupId: null,
              id: 'cmt-9',
              pageId: 'abp_1',
            },
          ],
          rounds: [
            {
              batchId: null,
              chosenBoardId: 'opt-b',
              id: 'rnd-1',
              pageId: 'abp_1',
              recommendedBoardId: 'opt-a',
              status: 'submitted',
              title: '布局',
            },
          ],
        },
      }),
      canvases: {},
      ok: true,
      staleBoardIds: [],
    });
    const result = await new ArtboardExecutionRuntime(service({ read })).readArtboard({
      id: 'art_1',
    });

    expect(result.content).toContain(
      '- rnd-1 on abp_1 "布局" · submitted · recommended opt-a · chosen opt-b',
    );
    expect(result.content).toContain('- opt-a on abp_1 in abg_2 round rnd-1 "方案 A"');
    expect(result.content).toContain('"已付费？" at (0, 0) 640×400 decision');
    expect(result.content).toContain('- edg-1 dec-1 → brd-1 "点「继续」" if: 已付费 (default)');
    expect(result.content).toContain('- cmt-9 on board brd-1: 能跳过吗？');
  });

  it('lists comment threads with their replies and where they sit', async () => {
    const listComments = vi.fn().mockResolvedValue({
      ok: true,
      threads: [
        thread({
          replies: [
            {
              authorAgentId: 'agt_1',
              authorUserId: null,
              content: '改成 44px',
              createdAt: new Date('2026-11-13T00:01:00.000Z'),
              id: 'cmt-2',
            },
          ],
        }),
      ],
    });
    const result = await new ArtboardExecutionRuntime(
      service({ listComments }),
    ).listArtboardComments({ id: 'art_1' });

    expect(listComments).toHaveBeenCalledWith({ id: 'art_1' });
    expect(result.content).toContain('- cmt-1 on board brd-1 · user: 按钮太小了');
    expect(result.content).toContain('  - cmt-2 · agent: 改成 44px');
    expect(result.state).toEqual({ artboardId: 'art_1', threadCount: 1 });
  });

  it('says so when no thread is open', async () => {
    const listComments = vi.fn().mockResolvedValue({ ok: true, threads: [] });
    const result = await new ArtboardExecutionRuntime(
      service({ listComments }),
    ).listArtboardComments({ id: 'art_1' });

    expect(result.success).toBe(true);
    expect(result.content).toBe('No unresolved comments on artboard art_1.');
  });

  it('replies to, resolves and opens threads through the service', async () => {
    const replyComment = vi.fn().mockResolvedValue({ commentId: 'cmt-3', ok: true });
    const resolveComment = vi.fn().mockResolvedValue({ commentId: 'cmt-1', ok: true });
    const askQuestion = vi.fn().mockResolvedValue({ commentId: 'cmt-4', ok: true });
    const runtime = new ArtboardExecutionRuntime(
      service({ askQuestion, replyComment, resolveComment }),
    );

    const reply = await runtime.replyArtboardComment({ commentId: 'cmt-1', content: '已改' });
    const resolved = await runtime.resolveArtboardComment({ commentId: 'cmt-1' });
    const asked = await runtime.askArtboardQuestion({
      boardId: 'brd-1',
      content: '能跳过吗？',
      id: 'art_1',
    });

    expect(reply.content).toContain('cmt-3');
    expect(resolved.content).toContain('Resolved thread cmt-1');
    expect(asked.content).toContain('cmt-4');
    expect(asked.content).toContain('finalize');
    expect(askQuestion).toHaveBeenCalledWith({
      boardId: 'brd-1',
      content: '能跳过吗？',
      id: 'art_1',
    });
  });

  it('passes a refused comment call back as a failure', async () => {
    const resolveComment = vi
      .fn()
      .mockResolvedValue({ code: 'not_found', message: 'No comment cmt-x', ok: false });
    const result = await new ArtboardExecutionRuntime(
      service({ resolveComment }),
    ).resolveArtboardComment({ commentId: 'cmt-x' });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ type: 'not_found' });
  });
});

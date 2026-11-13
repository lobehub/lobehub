import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerArtboardCommand } from './artboard';

const { create, list, output, read, update } = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  output: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
}));
vi.mock('../api/client', () => ({
  getTrpcClient: async () => ({
    artboard: {
      create: { mutate: create },
      list: { query: list },
      read: { query: read },
      update: { mutate: update },
    },
  }),
}));
vi.mock('../utils/format', () => ({ outputJson: output }));

const board = {
  content: {
    boards: [
      {
        expected: null,
        flowNodeId: null,
        groupId: 'abg_1',
        id: 'brd-1',
        pageId: 'abp_1',
        rect: { h: 400, w: 640, x: 0, y: 0 },
        roundId: null,
        source: { canvasId: 'cvs_1', kind: 'canvas', version: 1 },
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
  id: 'art_8f2k',
  phase: 'discuss',
  revision: 2,
  taskId: 'task_1',
  title: '首次进入',
};

describe('lh artboard', () => {
  let log: ReturnType<typeof vi.spyOn>;
  const originalTopic = process.env.LOBEHUB_TOPIC_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.LOBEHUB_TOPIC_ID = 'tpc_run';
  });

  afterEach(() => {
    log.mockRestore();
    if (originalTopic === undefined) delete process.env.LOBEHUB_TOPIC_ID;
    else process.env.LOBEHUB_TOPIC_ID = originalTopic;
  });

  const run = (args: string[]) => {
    const program = new Command();
    registerArtboardCommand(program);
    return program.parseAsync(args, { from: 'user' });
  };

  it('creates a board in the run’s conversation and prints the result line', async () => {
    create.mockResolvedValue({ artboard: board, changedIds: ['abg_1', 'brd-1'] });
    const ops = [{ group: { kind: 'journey', title: '旅程' }, type: 'addGroup' }];
    await run(['artboard', 'create', '--title', '首次进入', '--ops', JSON.stringify(ops)]);

    expect(create).toHaveBeenCalledWith({
      description: undefined,
      ops,
      taskId: undefined,
      title: '首次进入',
      topicId: 'tpc_run',
    });
    expect(log).toHaveBeenCalledWith('artboard art_8f2k · revision 2 · 1 groups · 1 boards');
  });

  it('needs --task when the run carries no conversation', async () => {
    delete process.env.LOBEHUB_TOPIC_ID;
    await expect(run(['artboard', 'create', '--title', 'x'])).rejects.toThrow('--task');
    expect(create).not.toHaveBeenCalled();
  });

  it('updates with the revision it read and prints JSON on request', async () => {
    update.mockResolvedValue({ artboard: board, changedIds: ['brd-1'] });
    const ops = [{ id: 'brd-1', patch: { x: 10 }, type: 'updateBoard' }];
    await run([
      'artboard',
      'update',
      'art_8f2k',
      '--revision',
      '1',
      '--ops',
      JSON.stringify(ops),
      '--json',
    ]);

    expect(update).toHaveBeenCalledWith({ id: 'art_8f2k', ops, revision: 1 });
    expect(output).toHaveBeenCalledWith({ artboard: board, changedIds: ['brd-1'] });
    expect(log).not.toHaveBeenCalled();
  });

  it('lists the boards of the run’s project', async () => {
    list.mockResolvedValue([board]);
    await run(['artboard', 'list']);
    expect(list).toHaveBeenCalledWith({ taskId: undefined, topicId: 'tpc_run' });
    expect(log).toHaveBeenCalledWith('art_8f2k  首次进入  discuss  revision 2');
  });

  it('reads a board and names the boards behind their Canvas', async () => {
    read.mockResolvedValue({ artboard: board, canvases: {}, staleBoardIds: ['brd-1'] });
    await run(['artboard', 'read', 'art_8f2k']);

    expect(read).toHaveBeenCalledWith({ id: 'art_8f2k' });
    expect(log).toHaveBeenCalledWith('artboard art_8f2k · revision 2 · 1 groups · 1 boards');
    expect(log).toHaveBeenCalledWith('stale board brd-1: its Canvas has a newer version');
  });
});

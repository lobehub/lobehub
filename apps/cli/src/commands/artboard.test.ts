import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerArtboardCommand } from './artboard';

const { create, list, listFiles, output, read, readFile, update, writeFiles } = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  listFiles: vi.fn(),
  output: vi.fn(),
  read: vi.fn(),
  readFile: vi.fn(),
  update: vi.fn(),
  writeFiles: vi.fn(),
}));
vi.mock('../api/client', () => ({
  getTrpcClient: async () => ({
    artboard: {
      create: { mutate: create },
      list: { query: list },
      listFiles: { query: listFiles },
      read: { query: read },
      readFile: { query: readFile },
      update: { mutate: update },
      writeFiles: { mutate: writeFiles },
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
        source: { hash: 'abc', kind: 'file', path: 'pages/empty.html' },
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
      files: undefined,
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

    expect(update).toHaveBeenCalledWith({ files: undefined, id: 'art_8f2k', ops, revision: 1 });
    expect(output).toHaveBeenCalledWith({ artboard: board, changedIds: ['brd-1'] });
    expect(log).not.toHaveBeenCalled();
  });

  it('lists the boards of the run’s project', async () => {
    list.mockResolvedValue([board]);
    await run(['artboard', 'list']);
    expect(list).toHaveBeenCalledWith({ taskId: undefined, topicId: 'tpc_run' });
    expect(log).toHaveBeenCalledWith('art_8f2k  首次进入  discuss  revision 2');
  });

  it('reads a board and prints its content', async () => {
    read.mockResolvedValue({ artboard: board });
    await run(['artboard', 'read', 'art_8f2k']);

    expect(read).toHaveBeenCalledWith({ id: 'art_8f2k' });
    expect(log).toHaveBeenCalledWith('artboard art_8f2k · revision 2 · 1 groups · 1 boards');
  });

  it('writes files and ops in one update', async () => {
    update.mockResolvedValue({ artboard: board, changedIds: [] });
    const files = { writes: [{ content: '<h1>A</h1>', path: 'pages/a.html' }] };
    await run([
      'artboard',
      'update',
      'art_8f2k',
      '--revision',
      '2',
      '--files',
      JSON.stringify(files),
    ]);

    expect(update).toHaveBeenCalledWith({ files, id: 'art_8f2k', ops: undefined, revision: 2 });
  });

  it('lists the files of a board with their sizes', async () => {
    listFiles.mockResolvedValue([{ hash: 'abc', path: 'pages/empty.html', size: 2048 }]);
    await run(['artboard', 'files', 'art_8f2k']);

    expect(log).toHaveBeenCalledWith('pages/empty.html  2048 B');
  });

  it('prints one file as text', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    readFile.mockResolvedValue({
      content: '<h1>空项目</h1>',
      hash: 'abc',
      path: 'pages/empty.html',
    });
    await run(['artboard', 'cat', 'art_8f2k', 'pages/empty.html']);

    expect(readFile).toHaveBeenCalledWith({ id: 'art_8f2k', path: 'pages/empty.html' });
    expect(write).toHaveBeenCalledWith('<h1>空项目</h1>');
    write.mockRestore();
  });
});

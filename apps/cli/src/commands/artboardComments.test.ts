import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerArtboardCommand } from './artboard';

const { askQuestion, output, read, replyAsAgent, resolveComment, takeComments } = vi.hoisted(
  () => ({
    askQuestion: vi.fn(),
    output: vi.fn(),
    read: vi.fn(),
    replyAsAgent: vi.fn(),
    resolveComment: vi.fn(),
    takeComments: vi.fn(),
  }),
);
vi.mock('../api/client', () => ({
  getTrpcClient: async () => ({
    artboard: {
      askQuestion: { mutate: askQuestion },
      read: { query: read },
      replyAsAgent: { mutate: replyAsAgent },
      resolveComment: { mutate: resolveComment },
      takeComments: { mutate: takeComments },
    },
  }),
}));
vi.mock('../utils/format', () => ({ outputJson: output }));

const content = {
  boards: [{ id: 'brd-1', pageId: 'abp_1', title: '购物清单' }],
  edges: [],
  groups: [{ id: 'abg_1', pageId: 'abp_1', title: '主流程' }],
  pages: [{ id: 'abp_1', name: '流程', sortOrder: 0 }],
  questions: [],
  rounds: [],
};

const comment = (id: string, text: string, agent = false) => ({
  authorAgentId: agent ? 'agt_run' : null,
  authorUserId: agent ? null : 'u1',
  content: text,
  createdAt: new Date(),
  id,
});

describe('lh artboard comments', () => {
  let log: ReturnType<typeof vi.spyOn>;
  const originalAgent = process.env.LOBEHUB_AGENT_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.LOBEHUB_AGENT_ID = 'agt_run';
    read.mockResolvedValue({ artboard: { content, id: 'art_1', revision: 3 } });
  });

  afterEach(() => {
    log.mockRestore();
    if (originalAgent === undefined) delete process.env.LOBEHUB_AGENT_ID;
    else process.env.LOBEHUB_AGENT_ID = originalAgent;
  });

  const run = (args: string[]) => {
    const program = new Command();
    registerArtboardCommand(program);
    return program.parseAsync(args, { from: 'user' });
  };

  const printed = () => log.mock.calls.map((call) => call.join(' ')).join('\n');

  it('takes the threads as the run’s agent and prints each with its id, place and replies', async () => {
    takeComments.mockResolvedValue([
      {
        ...comment('c1', '标签太弱'),
        boardId: 'brd-1',
        groupId: null,
        pageId: 'abp_1',
        replies: [comment('c2', '改成灰色胶囊', true)],
        resolvedAt: null,
        stale: false,
        unread: true,
      },
    ]);

    await run(['artboard', 'comments', 'art_1']);

    expect(takeComments).toHaveBeenCalledWith({ agentId: 'agt_run', id: 'art_1' });
    const text = printed();
    expect(text).toContain('c1');
    expect(text).toContain('购物清单');
    expect(text).toContain('new');
    expect(text).toContain('user: 标签太弱');
    expect(text).toContain('you: 改成灰色胶囊');
  });

  it('says so when no thread is waiting', async () => {
    takeComments.mockResolvedValue([]);
    await run(['artboard', 'comments', 'art_1']);
    expect(printed()).toMatch(/no comment/i);
  });

  it('replies, resolves and asks as the run’s agent', async () => {
    replyAsAgent.mockResolvedValue({ id: 'c3' });
    resolveComment.mockResolvedValue({ id: 'c1' });
    askQuestion.mockResolvedValue({ id: 'c4' });

    await run(['artboard', 'reply', 'c1', '已改成灰色胶囊']);
    await run(['artboard', 'resolve', 'c1']);
    await run(['artboard', 'ask', 'art_1', '--board', 'brd-1', '入口放哪？']);

    expect(replyAsAgent).toHaveBeenCalledWith({
      agentId: 'agt_run',
      commentId: 'c1',
      content: '已改成灰色胶囊',
    });
    expect(resolveComment).toHaveBeenCalledWith({ commentId: 'c1' });
    expect(askQuestion).toHaveBeenCalledWith({
      agentId: 'agt_run',
      boardId: 'brd-1',
      content: '入口放哪？',
      groupId: undefined,
      id: 'art_1',
      pageId: undefined,
    });
  });

  it('refuses to speak for an agent outside an agent run', async () => {
    delete process.env.LOBEHUB_AGENT_ID;
    await expect(run(['artboard', 'comments', 'art_1'])).rejects.toThrow('LOBEHUB_AGENT_ID');
    expect(takeComments).not.toHaveBeenCalled();
  });
});

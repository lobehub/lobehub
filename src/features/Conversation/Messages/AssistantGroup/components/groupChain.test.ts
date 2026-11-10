import { describe, expect, it } from 'vitest';

import type { AssistantContentBlock } from '@/types/index';

import { buildChainView, getChainDurationsMs } from './groupChain';

const blk = (id: string) => ({ content: '', id }) as AssistantContentBlock;

describe('getChainDurationsMs', () => {
  it('ends an interrupted turn at the steer that interrupted it', () => {
    const dbMessages = [
      { createdAt: 1000, id: 'a1' },
      { createdAt: 15_000, id: 'steer-1' },
      { createdAt: 15_100, id: 'b1' },
      { createdAt: 20_000, id: 'b2' },
    ];

    expect(
      getChainDurationsMs(dbMessages, [
        { blocks: [blk('a1')], id: 'a1' },
        { blocks: [blk('b1'), blk('b2')], id: 'g2', steerUserId: 'steer-1' },
      ]),
    ).toEqual([14_000, 4900]);
  });

  it('keeps the step span for the last or only turn', () => {
    const dbMessages = [
      { createdAt: 1000, id: 'a1' },
      { createdAt: 4000, id: 'a2' },
    ];

    expect(getChainDurationsMs(dbMessages, [{ blocks: [blk('a1'), blk('a2')], id: 'g1' }])).toEqual(
      [3000],
    );
    expect(getChainDurationsMs(dbMessages, [{ blocks: [blk('a1')], id: 'g1' }])).toEqual([0]);
  });

  it('falls back to the step span when the steer row is not loaded', () => {
    const dbMessages = [
      { createdAt: 1000, id: 'a1' },
      { createdAt: 2500, id: 'a2' },
      { createdAt: 9000, id: 'b1' },
    ];

    expect(
      getChainDurationsMs(dbMessages, [
        { blocks: [blk('a1'), blk('a2')], id: 'g1' },
        { blocks: [blk('b1')], id: 'g2', steerUserId: 'missing' },
      ]),
    ).toEqual([1500, 0]);
  });
});

describe('buildChainView task-completion notices', () => {
  const tool = (id: string) => ({
    apiName: 'Bash',
    arguments: '{}',
    id,
    identifier: 'claude-code',
    type: 'default' as const,
  });
  const signal = (sourceToolCallId: string) => ({
    signal: { sourceToolCallId, sourceToolName: 'Agent', type: 'task-completion' },
  });

  it('marks each wake-up step once, on its first rendered projection', () => {
    const view = buildChainView(
      {
        blocks: [
          { content: '', id: 'run', tools: [tool('a'), tool('b')] },
          {
            content: 'The first subagent is back. Its findings hold up after a spot-check.',
            id: 'wake',
            metadata: signal('a'),
            tools: [tool('c')],
          },
          { content: 'B is done, one to go', id: 'done', metadata: signal('b') },
          { content: '', id: 'wake2', metadata: signal('x'), tools: [tool('d')] },
          { content: 'final summary', id: 'final' },
        ] as AssistantContentBlock[],
        id: 'group',
      },
      { hasActiveOperation: false, isGenerating: false },
    );

    const rendered = view.segments.flatMap((segment) =>
      segment.kind === 'answer' ? [segment.block] : segment.blocks,
    );

    expect(rendered.filter((block) => block.id === 'wake')).toHaveLength(2);
    expect(
      rendered.filter((block) => block.showTaskCompletionNotice).map((block) => block.id),
    ).toEqual(['wake', 'done', 'wake2']);
    expect(rendered.find((block) => block.id === 'wake')?.showTaskCompletionNotice).toBe(true);
  });
});

describe('buildChainView MCP App views', () => {
  const appTool = {
    apiName: 'show_dashboard',
    arguments: '{}',
    id: 't1',
    identifier: 'dash',
    result: { content: 'ok', id: 'r1', state: { mcpApp: { resourceUri: 'ui://dash/view' } } },
    type: 'mcp' as const,
  };
  const nextTool = { ...appTool, apiName: 'search', id: 't2', result: undefined };
  // The segment key the group renders the view under (`getChainSegmentKey`)
  const viewKey = (tools: unknown[]) =>
    buildChainView(
      { blocks: [{ content: '', id: 'step1', tools }] as AssistantContentBlock[], id: 'group' },
      { enableMcpApps: true, hasActiveOperation: true, isGenerating: true },
    ).segments.flatMap((segment) => (segment.kind === 'workflow' ? segment.blocks : []))[0]
      ?.renderKey;

  it('keeps the key of a lone view once the model calls another tool in its step', () => {
    const alone = viewKey([appTool]);

    expect(alone).toBeDefined();
    expect(viewKey([appTool, nextTool])).toBe(alone);
  });
});

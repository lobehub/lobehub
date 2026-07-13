import { describe, expect, it } from 'vitest';

import { type AssistantContentBlock } from '@/types/index';

import {
  getPostToolAnswerSplitIndex,
  getToolDisplayName,
  getWorkflowStreamingHeadlineState,
  getWorkflowSummaryText,
  isFoldableStatusLine,
  shapeProseForWorkflowHeadline,
} from './toolDisplayNames';

const blk = (p: Partial<AssistantContentBlock> & { id: string }): AssistantContentBlock =>
  ({ content: '', ...p }) as AssistantContentBlock;

describe('tool display names', () => {
  it('uses friendly labels for Codex tool api names', () => {
    expect(getToolDisplayName('command_execution')).toBe('Ran a command');
    expect(getToolDisplayName('file_change')).toBe('Edited a file');
    expect(getToolDisplayName('mcp_tool_call')).toBe('Called MCP tool');
    expect(getToolDisplayName('todo_list')).toBe('Updated todos');
    expect(getToolDisplayName('web_search')).toBe('Searched the web');
  });

  it('uses friendly Codex labels in workflow summaries', () => {
    const summary = getWorkflowSummaryText([
      blk({
        id: '0',
        tools: [
          { apiName: 'command_execution', id: 'tool-1', result: { content: 'ok' } } as any,
          { apiName: 'command_execution', id: 'tool-2', result: { content: 'ok' } } as any,
          { apiName: 'file_change', id: 'tool-3', result: { content: 'ok' } } as any,
          { apiName: 'mcp_tool_call', id: 'tool-4', result: { content: 'ok' } } as any,
          { apiName: 'web_search', id: 'tool-5', result: { content: 'ok' } } as any,
        ],
      }),
    ]);

    expect(summary).toContain('Ran a command (2)');
    expect(summary).toContain('Edited a file');
    expect(summary).toContain('Called MCP tool');
    expect(summary).toContain('Searched the web');
    expect(summary).not.toContain('Command_execution');
    expect(summary).not.toContain('File_change');
    expect(summary).not.toContain('Mcp_tool_call');
    expect(summary).not.toContain('Web_search');
  });

  it('leads the summary with the total call count and appends the tool-kind count when truncated', () => {
    const tools = [
      ...Array.from({ length: 6 }, (_, i) => ({ apiName: 'a', id: `a-${i}` })),
      ...Array.from({ length: 4 }, (_, i) => ({ apiName: 'b', id: `b-${i}` })),
      ...Array.from({ length: 2 }, (_, i) => ({ apiName: 'c', id: `c-${i}` })),
      { apiName: 'd', id: 'd-0' },
      { apiName: 'e', id: 'e-0', result: { error: { message: 'boom' } } },
      { apiName: 'f', id: 'f-0' },
    ];
    const summary = getWorkflowSummaryText([blk({ id: '0', tools: tools as any })]);

    // total calls (15) leads, "calls total" / "共" wording is gone
    expect(summary.startsWith('15 calls:')).toBe(true);
    expect(summary).not.toContain('calls total');
    // truncated tool list is followed by the kind count, then the failure count
    expect(summary).toContain('across 6 tools');
    expect(summary).toContain('1 failed');
  });

  it('omits the total call count when each tool is called once', () => {
    const summary = getWorkflowSummaryText([
      blk({
        id: '0',
        tools: [
          { apiName: 'a', id: 'a-0' },
          { apiName: 'b', id: 'b-0' },
        ] as any,
      }),
    ]);

    expect(summary).not.toContain('calls:');
  });

  it('uses friendly labels for Linear MCP tool names', () => {
    expect(getToolDisplayName('mcp__claude_ai_Linear__save_issue')).toBe('Linear · Save issue');
    expect(getToolDisplayName('mcp__linear-server__get_issue')).toBe('Linear · Get issue');
  });

  it('uses friendly labels for the in-app browser MCP tool names', () => {
    // Title-casing the wire name yields "Mcp  lobe cc  browser navigate".
    expect(getToolDisplayName('mcp__lobe_cc__browser_navigate')).toBe('Open page');
    expect(getToolDisplayName('mcp__lobe_cc__browser_screenshot')).toBe('Screenshot page');
    expect(getToolDisplayName('mcp__lobe_cc__browser_read_page')).toBe('Read page text');
  });

  it('leaves unknown MCP tools on the title-case fallback', () => {
    expect(getToolDisplayName('mcp__lobe_cc__something_else')).toBe('Mcp__lobe_cc__something_else');
  });
});

describe('shapeProseForWorkflowHeadline', () => {
  it('does not split on dot inside Node.js in CJK prose', () => {
    const s =
      '我来帮您搜索 Node.js 24 的发布说明并撰写一份全面的技术总结。首先，我需要激活必要的工具来进行搜索和文件操作。';
    const out = shapeProseForWorkflowHeadline(s);
    expect(out).toContain('Node.js 24');
    expect(out).toContain('技术总结');
    expect(out).not.toMatch(/^我来帮您搜索 Node\.?\s*$/i);
  });

  it('uses Latin sentence dot when no CJK', () => {
    const s = 'Search Node.js 24 release notes. Then crawl docs.';
    const out = shapeProseForWorkflowHeadline(s);
    expect(out).toContain('Node.js 24');
    expect(out).toContain('release notes');
    expect(out).not.toContain('Then crawl');
  });
});

describe('isFoldableStatusLine', () => {
  it('keeps a single short status line folded', () => {
    expect(isFoldableStatusLine(blk({ id: '0', content: '先重建 worktree:' }))).toBe(true);
    expect(isFoldableStatusLine(blk({ id: '1', content: '现在我来搜索资料。' }))).toBe(true);
  });

  it('keeps a single sentence with a dotted token folded', () => {
    // "src/a.ts" and "Node.js" must not be counted as extra sentence boundaries.
    expect(isFoldableStatusLine(blk({ id: '0', content: '已更新 src/a.ts 完成。' }))).toBe(true);
    expect(isFoldableStatusLine(blk({ id: '1', content: '升级到 Node.js 24。' }))).toBe(true);
  });

  it('treats multi-sentence, multi-line, markdown or long lines as prose', () => {
    expect(isFoldableStatusLine(blk({ id: '0', content: '第一句话。第二句话。' }))).toBe(false);
    expect(isFoldableStatusLine(blk({ id: '1', content: '先总结。\n\n## 下一步' }))).toBe(false);
    expect(isFoldableStatusLine(blk({ id: '2', content: '- 对比方案 A' }))).toBe(false);
    expect(isFoldableStatusLine(blk({ id: '3', content: 'x'.repeat(120) }))).toBe(false);
  });

  it('treats empty / loading content as foldable (nothing to lift out)', () => {
    expect(isFoldableStatusLine(blk({ id: '0', content: '' }))).toBe(true);
  });
});

describe('post-tool answer split', () => {
  it('returns split index for real prose block after last tool', () => {
    const long =
      'Direct summary - Node.js 24 (released May 6, 2025) is a major platform update that upgrades V8 to a newer track, ships notable HTTP and fetch-related changes, and introduces practical migration items for native addons and tooling.\n\n## Checklist\n\n- Rebuild native modules';
    const blocks = [
      blk({ id: '0', content: 'intro', tools: [{ apiName: 'search', id: 't1' } as any] }),
      blk({ id: '1', content: long }),
    ];
    const ix = getPostToolAnswerSplitIndex(blocks, 0, true, true);
    expect(ix).toBe(1);
  });

  it('splits on a multi-sentence prose block after tools', () => {
    const blocks = [
      blk({ id: '0', content: 'x', tools: [{ apiName: 'search', id: 't1' } as any] }),
      blk({ id: '1', content: '先跑测试。全部通过了。' }),
    ];
    expect(getPostToolAnswerSplitIndex(blocks, 0, true, true)).toBe(1);
  });

  it('does not split a short single-line step after tools', () => {
    const blocks = [
      blk({ id: '0', content: 'x', tools: [{ apiName: 'search', id: 't1' } as any] }),
      blk({ id: '1', content: '现在我来搜索资料。' }),
    ];
    expect(getPostToolAnswerSplitIndex(blocks, 0, true, true)).toBeNull();
  });
});

describe('reasoning headline extraction', () => {
  it('uses the last markdown heading for a trailing thinking-only block', () => {
    const state = getWorkflowStreamingHeadlineState([
      blk({
        id: '0',
        content: '',
        reasoning: {
          content:
            '# Initial framing\n\nSome details.\n\n## Search release notes\n\nMore details.\n\n### Finalize patch plan',
        } as any,
      }),
    ]);

    expect(state).toEqual({
      kind: 'thinking',
      reasoningTitle: 'Finalize patch plan',
    });
  });

  it('prefers tool state when the trailing block has tools', () => {
    const state = getWorkflowStreamingHeadlineState([
      blk({
        id: '0',
        reasoning: {
          content: '### Search release notes',
        } as any,
      }),
      blk({
        id: '1',
        tools: [
          {
            apiName: 'search',
            arguments: '{"query":"Node.js 24"}',
            result: {
              state: { workflowHeadline: { stepMessage: 'Searching release notes' } },
            },
          } as any,
        ],
      }),
    ]);

    expect(state).toEqual({
      explicitStep: 'Searched the web: Searching release notes',
      fallbackTool: 'Searched the web: Node.js 24',
      kind: 'tool',
    });
  });

  it('uses prose state when the trailing block is prose', () => {
    const state = getWorkflowStreamingHeadlineState([
      blk({
        id: '0',
        tools: [{ apiName: 'search', id: 't1' } as any],
      }),
      blk({
        id: '1',
        content: 'Now I will compare the release notes and summarize the migration changes.',
        reasoning: {
          content: '### Planning',
        } as any,
      }),
    ]);

    expect(state).toEqual({
      kind: 'prose',
      proseSource: 'Now I will compare the release notes and summarize the migration changes.',
    });
  });

  it('falls back to the previous usable block when trailing thinking has no heading', () => {
    const state = getWorkflowStreamingHeadlineState([
      blk({
        id: '0',
        tools: [
          {
            apiName: 'search',
            arguments: '{"query":"Node.js 24"}',
            result: {
              state: { workflowHeadline: { stepMessage: 'Searching release notes' } },
            },
          } as any,
        ],
      }),
      blk({
        id: '1',
        reasoning: {
          content: 'Thinking through the comparison strategy without a markdown heading.',
        } as any,
      }),
    ]);

    expect(state).toEqual({
      explicitStep: 'Searched the web: Searching release notes',
      fallbackTool: 'Searched the web: Node.js 24',
      kind: 'tool',
    });
  });

  it('falls back to the previous usable block when trailing prose is too short', () => {
    const state = getWorkflowStreamingHeadlineState([
      blk({
        id: '0',
        reasoning: {
          content: '### Search release notes',
        } as any,
      }),
      blk({
        id: '1',
        content: 'ok',
      }),
    ]);

    expect(state).toEqual({
      kind: 'thinking',
      reasoningTitle: 'Search release notes',
    });
  });
});

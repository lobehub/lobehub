import { describe, expect, it } from 'vitest';

import type { AssistantContentBlock } from '@/types/index';

import {
  getToolDisplayName,
  getWorkflowStreamingHeadlineState,
  getWorkflowSummaryText,
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

  it('summarises a workflow as the total call count only', () => {
    const summary = getWorkflowSummaryText([
      blk({
        id: '0',
        tools: [
          { apiName: 'command_execution', id: 'tool-1', result: { content: 'ok' } } as any,
          { apiName: 'command_execution', id: 'tool-2', result: { content: 'ok' } } as any,
          { apiName: 'file_change', id: 'tool-3', result: { content: 'ok' } } as any,
        ],
      }),
      blk({
        id: '1',
        tools: [{ apiName: 'web_search', id: 'tool-4', result: { content: 'ok' } } as any],
      }),
    ]);

    // No per-tool breakdown in the fold — the expanded list already has it.
    expect(summary).toBe('4 calls');
  });

  it('counts a single call too, instead of naming the tool', () => {
    const summary = getWorkflowSummaryText([
      blk({ id: '0', tools: [{ apiName: 'command_execution', id: 'tool-1' }] as any }),
    ]);

    // Plural form depends on the active language (the test i18n runs zh rules).
    expect(summary).toMatch(/^1 calls?$/);
  });

  it('falls back to reasoning time when a workflow has no tool calls', () => {
    const summary = getWorkflowSummaryText([
      blk({ id: '0', reasoning: { content: '', duration: 21_000 } as any }),
    ]);

    expect(summary).toBe('Thought for 21s');
  });

  it('uses friendly labels for Linear MCP tool names', () => {
    expect(getToolDisplayName('mcp__claude_ai_Linear__save_issue')).toBe('Linear · Save issue');
    expect(getToolDisplayName('mcp__linear-server__get_issue')).toBe('Linear · Get issue');
  });

  it('uses friendly labels for the in-app browser MCP tool names', () => {
    // Title-casing the wire name yields "Mcp  lobe cc  browser navigate".
    // Past tense: the summary reports what already ran, not an offer to run it.
    expect(getToolDisplayName('mcp__lobe_cc__browser_navigate')).toBe('Opened page');
    expect(getToolDisplayName('mcp__lobe_cc__browser_screenshot')).toBe('Captured screenshot');
    expect(getToolDisplayName('mcp__lobe_cc__browser_read_page')).toBe('Read page text');
    // `snapshot` returns the a11y tree — say what the agent got, not the wire name.
    expect(getToolDisplayName('mcp__lobe_cc__browser_snapshot')).toBe('Read page elements');
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
      fallbackTool: 'Searched the web Node.js 24',
      kind: 'tool',
    });
  });

  it('renders the running headline as action label + keyword, never the raw args', () => {
    const state = getWorkflowStreamingHeadlineState([
      blk({
        id: '0',
        tools: [
          {
            apiName: 'Bash',
            arguments: JSON.stringify({
              command: 'set -a && source .env && set +a && npx tsx scripts/gross-margin/monthly.ts',
            }),
            id: 't1',
            identifier: 'claude-code',
          } as any,
        ],
      }),
    ]);

    // the plugin i18n namespace is not registered in the test harness, so the
    // label falls back to the apiName; the shape under test is label + keyword.
    expect(state.kind).toBe('tool');
    expect((state as any).fallbackTool).toMatch(/ monthly\.ts$/);
    expect((state as any).fallbackTool).not.toContain('set -a');
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
      fallbackTool: 'Searched the web Node.js 24',
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

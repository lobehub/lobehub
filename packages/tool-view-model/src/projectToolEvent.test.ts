import { describe, expect, it } from 'vitest';

import { projectToolEndResult } from './projectToolEvent';

const toolEndData = (
  result: Record<string, unknown>,
  identifier = 'lobe-web-browsing',
  apiName = 'crawlSinglePage',
) => ({
  executionTime: 12,
  isSuccess: true,
  payload: { parentMessageId: 'msg-1', toolCalling: { apiName, identifier } },
  phase: 'tool_execution',
  result,
});

describe('projectToolEndResult', () => {
  it('drops the body of a tool no hook reads', () => {
    const projected = projectToolEndResult(
      toolEndData({ content: 'RAW BODY', success: true }),
    ) as any;

    expect('content' in projected.result).toBe(false);
    expect(projected.result.success).toBe(true);
  });

  it('keeps the fields the executor hooks and the Work refresh read', () => {
    const projected = projectToolEndResult(
      toolEndData({ content: 'RAW BODY', success: false, workRegistration: { type: 'skill' } }),
    ) as any;

    expect(projected.result.workRegistration).toEqual({ type: 'skill' });
    expect(projected.result.success).toBe(false);
    expect(projected.isSuccess).toBe(true);
    expect(projected.executionTime).toBe(12);
    expect(projected.payload).toEqual({
      parentMessageId: 'msg-1',
      toolCalling: { apiName: 'crawlSinglePage', identifier: 'lobe-web-browsing' },
    });
  });

  it('projects the state through the same projector the read path uses', () => {
    const projected = projectToolEndResult(
      toolEndData({
        content: 'RAW BODY',
        state: { results: [{ crawler: 'naive', data: { content: 'x'.repeat(5000) }, url: 'u' }] },
        success: true,
      }),
    ) as any;

    const [entry] = projected.result.state.results;
    expect(entry.data.content.length).toBeLessThan(5000);
    expect(entry.data.length).toBe(5000);
  });

  // The renderer-side hooks parse a shell result's body to learn the branch a
  // run switched to and the PR it opened. Dropping it loses the topic binding.
  it.each([
    ['lobe-local-system', 'runCommand'],
    ['claude-code', 'Bash'],
    ['codex', 'command_execution'],
    ['opencode', 'bash'],
    ['pi', 'bash'],
    ['claude-code', 'EnterWorktree'],
  ])('keeps the body of %s/%s, whose hook parses it', (identifier, apiName) => {
    const projected = projectToolEndResult(
      toolEndData(
        { content: 'Switched to branch feat/x', state: { exitCode: 0 }, success: true },
        identifier,
        apiName,
      ),
    ) as any;

    expect(projected.result.content).toBe('Switched to branch feat/x');
    expect(projected.result.state.exitCode).toBe(0);
  });

  it.each([
    ['lobe-agent-documents', 'listDocuments', { documents: [{ id: 'a' }] }, { documentCount: 1 }],
    ['lobe-user-memory', 'searchUserMemory', { identities: [{ id: 'a' }] }, { resultCount: 1 }],
    [
      'lobe-local-system',
      'grepContent',
      { matches: ['/a.ts'], pattern: 'x', totalMatches: 1 },
      { pattern: 'x', totalMatches: 1 },
    ],
    [
      'lobe-cloud-sandbox',
      'grepContent',
      { matches: ['/a.ts'], pattern: 'x', totalMatches: 1 },
      { pattern: 'x', totalMatches: 1 },
    ],
    [
      'lobe-web-browsing',
      'search',
      { query: 'x', results: [{ url: 'https://a' }] },
      { query: 'x', resultCount: 1 },
    ],
    [
      'lobe-knowledge-base',
      'searchKnowledgeBase',
      { chunks: [], fileResults: [{ id: 'f1' }] },
      { resultCount: 1 },
    ],
  ])('drops the body of %s/%s and projects its state', (identifier, apiName, state, expected) => {
    const projected = projectToolEndResult(
      toolEndData({ content: 'RAW BODY', state, success: true }, identifier, apiName),
    ) as any;

    expect('content' in projected.result).toBe(false);
    expect(projected.result.state).toEqual(expected);
  });

  it('keeps the body of a tool with no projector — nothing has vouched for it', () => {
    const data = toolEndData({ content: 'RAW BODY', state: { anything: 1 } }, 'some-mcp-plugin');

    expect(projectToolEndResult(data)).toBe(data);
  });

  it('leaves data it does not recognize alone', () => {
    expect(projectToolEndResult(undefined)).toBeUndefined();
    expect(projectToolEndResult({ result: 'not-an-object' })).toEqual({ result: 'not-an-object' });

    const bodiless = { payload: {}, result: { success: true } };
    expect(projectToolEndResult(bodiless)).toBe(bodiless);
  });
});

import { describe, expect, it } from 'vitest';

import { buildCodexImportPayload, parseCodexSession, parseCodexSessionDigest } from './codex';

const SESSION_ID = '019db91a-a0ea-7b71-9a8c-377aefb30219';

const line = (record: Record<string, any>) => JSON.stringify(record);

const sessionMeta = () =>
  line({
    payload: {
      cli_version: '0.122.0',
      cwd: '/repo',
      git: { branch: 'feat/some-branch' },
      id: SESSION_ID,
      source: 'exec',
    },
    timestamp: '2026-04-23T06:50:25.085Z',
    type: 'session_meta',
  });

const responseItem = (payload: Record<string, any>, timestamp = '2026-04-23T06:50:30.000Z') =>
  line({ payload, timestamp, type: 'response_item' });

const userMessage = (text: string) =>
  responseItem({ content: [{ text, type: 'input_text' }], role: 'user', type: 'message' });

const assistantMessage = (text: string) =>
  responseItem({ content: [{ text, type: 'output_text' }], role: 'assistant', type: 'message' });

describe('parseCodexSession', () => {
  it('maps the linear rollout into user/assistant/tool messages', () => {
    const transcript = [
      sessionMeta(),
      line({ payload: { cwd: '/repo', model: 'gpt-5.4' }, type: 'turn_context' }),
      userMessage('# AGENTS.md instructions for /repo\nscaffolding'),
      userMessage('<environment_context>...</environment_context>'),
      userMessage('帮我看下这个 commit'),
      responseItem({
        content: [],
        encrypted_content: 'xxx',
        summary: [{ text: 'I should inspect the repo', type: 'summary_text' }],
        type: 'reasoning',
      }),
      responseItem({
        arguments: '{"cmd":"git log -1"}',
        call_id: 'call_1',
        name: 'exec_command',
        type: 'function_call',
      }),
      responseItem({ call_id: 'call_1', output: 'commit abc123', type: 'function_call_output' }),
      assistantMessage('这个 commit 修复了 FK 问题'),
      line({
        payload: {
          info: {
            last_token_usage: {
              cached_input_tokens: 80,
              input_tokens: 100,
              output_tokens: 50,
              reasoning_output_tokens: 10,
              total_tokens: 150,
            },
          },
          type: 'token_count',
        },
        type: 'event_msg',
      }),
    ].join('\n');

    const result = parseCodexSession(transcript)!;
    expect(result.sessionId).toBe(SESSION_ID);
    expect(result.workingDirectory).toBe('/repo');
    expect(result.gitBranch).toBe('feat/some-branch');
    expect(result.title).toBe('帮我看下这个 commit');

    const roles = result.messages.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant']);

    const [user, callMsg, toolMsg, answer] = result.messages;
    expect(user.content).toBe('帮我看下这个 commit');

    // the function_call becomes an assistant message carrying the tool + reasoning
    expect(callMsg.tools).toHaveLength(1);
    expect(callMsg.tools![0]).toMatchObject({
      apiName: 'exec_command',
      id: 'call_1',
      identifier: 'codex',
    });
    expect(callMsg.reasoning?.content).toBe('I should inspect the repo');
    expect(callMsg.model).toBe('gpt-5.4');

    expect(toolMsg.content).toBe('commit abc123');
    expect(toolMsg.toolCallId).toBe('call_1');
    expect(toolMsg.parentClientId).toBe(callMsg.clientId);
    expect(toolMsg.plugin).toMatchObject({ apiName: 'exec_command', identifier: 'codex' });

    expect(answer.content).toBe('这个 commit 修复了 FK 问题');
    // token_count usage lands on the latest assistant message, normalized to
    // the ModelUsage shape (codex input_tokens INCLUDES the cached portion)
    expect(answer.usage).toEqual({
      inputCacheMissTokens: 20,
      inputCachedTokens: 80,
      outputReasoningTokens: 10,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalTokens: 150,
    });
  });

  it('skips scaffolding and developer messages entirely', () => {
    const transcript = [
      sessionMeta(),
      responseItem({
        content: [{ text: 'be a good agent', type: 'input_text' }],
        role: 'developer',
        type: 'message',
      }),
      userMessage('# AGENTS.md instructions for /repo'),
      userMessage('<user_instructions>stuff</user_instructions>'),
      userMessage('real question'),
      assistantMessage('real answer'),
    ].join('\n');

    const result = parseCodexSession(transcript)!;
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toBe('real question');
  });

  it('produces deterministic clientIds so re-parsing is stable', () => {
    const transcript = [sessionMeta(), userMessage('q'), assistantMessage('a')].join('\n');
    const first = parseCodexSession(transcript)!.messages.map((m) => m.clientId);
    const second = parseCodexSession(transcript)!.messages.map((m) => m.clientId);
    expect(first).toEqual(second);
    // appending records must not shift existing ids
    const grown = parseCodexSession(`${transcript}\n${assistantMessage('more')}`)!;
    expect(grown.messages.slice(0, 2).map((m) => m.clientId)).toEqual(first);
  });

  it('returns null for rollouts without conversation', () => {
    expect(parseCodexSession('')).toBeNull();
    expect(parseCodexSession(sessionMeta())).toBeNull();
    expect(
      parseCodexSession([sessionMeta(), userMessage('# AGENTS.md instructions')].join('\n')),
    ).toBeNull();
  });
});

describe('buildCodexImportPayload', () => {
  it('produces a payload with resume metadata and deterministic topic clientId', () => {
    const transcript = [sessionMeta(), userMessage('hello'), assistantMessage('hi')].join('\n');
    const payload = buildCodexImportPayload(transcript)!;
    expect(payload.topicClientId).toBe(`codex-session-${SESSION_ID}`);
    expect(payload.source).toBe('codex');
    expect(payload.metadata).toEqual({
      heteroSessionId: SESSION_ID,
      heteroSessionIdByWorkingDirectory: { '/repo': SESSION_ID },
      importedFrom: 'codex-local',
    });
  });
});

describe('parseCodexSessionDigest', () => {
  it('extracts list metadata', () => {
    const transcript = [
      sessionMeta(),
      userMessage('# AGENTS.md instructions'),
      userMessage('first real prompt'),
      assistantMessage('answer'),
    ].join('\n');

    const digest = parseCodexSessionDigest(transcript, '/tmp/rollout.jsonl')!;
    expect(digest.sessionId).toBe(SESSION_ID);
    expect(digest.title).toBe('first real prompt');
    expect(digest.workingDirectory).toBe('/repo');
    expect(digest.gitBranch).toBe('feat/some-branch');
    expect(digest.source).toBe('codex');
  });

  it('accumulates fresh-input + output tokens across turns', () => {
    const tokenCount = (input: number, cached: number, output: number) =>
      line({
        payload: {
          info: {
            last_token_usage: {
              cached_input_tokens: cached,
              input_tokens: input,
              output_tokens: output,
            },
          },
          type: 'token_count',
        },
        type: 'event_msg',
      });
    const transcript = [
      sessionMeta(),
      userMessage('q'),
      assistantMessage('a'),
      tokenCount(1000, 800, 50),
      tokenCount(2000, 1900, 100),
    ].join('\n');

    const digest = parseCodexSessionDigest(transcript, '/tmp/rollout.jsonl')!;
    expect(digest.tokens).toBe(200 + 250); // (1000-800+50) + (2000-1900+100)
  });

  it('returns null when only scaffolding user messages exist', () => {
    const transcript = [sessionMeta(), userMessage('# AGENTS.md instructions')].join('\n');
    expect(parseCodexSessionDigest(transcript, '/tmp/rollout.jsonl')).toBeNull();
  });
});

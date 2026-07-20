import { describe, expect, it } from 'vitest';

import {
  buildClaudeCodeImportPayload,
  parseClaudeCodeSession,
  parseClaudeCodeSessionDigest,
} from './claudeCode';

const SESSION_ID = 'sess-0001';

const line = (record: Record<string, any>) => JSON.stringify(record);

const userRecord = (uuid: string, parentUuid: string | null, text: string, extra?: any) =>
  line({
    cwd: '/repo',
    gitBranch: 'main',
    isSidechain: false,
    message: { content: [{ text, type: 'text' }], role: 'user' },
    parentUuid,
    sessionId: SESSION_ID,
    timestamp: '2026-07-01T00:00:00.000Z',
    type: 'user',
    uuid,
    ...extra,
  });

const assistantRecord = (
  uuid: string,
  parentUuid: string,
  msgId: string,
  block: Record<string, any>,
  extra?: any,
) =>
  line({
    isSidechain: false,
    message: {
      content: [block],
      id: msgId,
      model: 'claude-opus-4-8',
      usage: { input_tokens: 10, output_tokens: 20, service_tier: 'standard', speed: 'fast' },
    },
    parentUuid,
    sessionId: SESSION_ID,
    timestamp: '2026-07-01T00:00:01.000Z',
    type: 'assistant',
    uuid,
    ...extra,
  });

const toolResultRecord = (uuid: string, parentUuid: string, toolUseId: string, text: string) =>
  line({
    isSidechain: false,
    message: {
      content: [{ content: text, tool_use_id: toolUseId, type: 'tool_result' }],
      role: 'user',
    },
    parentUuid,
    sessionId: SESSION_ID,
    timestamp: '2026-07-01T00:00:02.000Z',
    type: 'user',
    uuid,
  });

describe('parseClaudeCodeSession', () => {
  it('merges assistant lines sharing message.id into one message', () => {
    const transcript = [
      userRecord('u1', null, 'hello'),
      assistantRecord('a1', 'u1', 'msg_1', { thinking: 'let me think', type: 'thinking' }),
      assistantRecord('a2', 'a1', 'msg_1', { text: 'the answer', type: 'text' }),
      line({ leafUuid: 'a2', sessionId: SESSION_ID, type: 'last-prompt' }),
    ].join('\n');

    const result = parseClaudeCodeSession(transcript)!;
    expect(result.messages).toHaveLength(2);
    const assistant = result.messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toBe('the answer');
    expect(assistant.reasoning?.content).toBe('let me think');
    expect(assistant.model).toBe('claude-opus-4-8');
    expect(assistant.provider).toBe('claude-code');
    // raw Anthropic usage is normalized into the ModelUsage shape; non-token
    // extras (service_tier / speed) are relocated into metadata
    expect(assistant.usage).toEqual({
      inputCacheMissTokens: 10,
      totalInputTokens: 10,
      totalOutputTokens: 20,
      totalTokens: 30,
    });
    expect(assistant.metadata?.serviceTier).toBe('standard');
    expect(assistant.metadata?.speed).toBe('fast');
    // heteroMessageId = the record's own uuid in the CC session file (first
    // record of the merged group), NOT the reusable Anthropic API message.id
    expect(assistant.metadata?.heteroMessageId).toBe('a1');
    expect(result.messages[0].metadata?.heteroMessageId).toBe('u1');
    expect(assistant.parentClientId).toBe(`claude-code-u1`);
  });

  it('skips signature-only empty thinking blocks instead of writing empty reasoning', () => {
    const transcript = [
      userRecord('u1', null, 'hello'),
      assistantRecord('a1', 'u1', 'msg_1', { signature: 'sig==', thinking: '', type: 'thinking' }),
      assistantRecord('a2', 'a1', 'msg_1', { text: 'the answer', type: 'text' }),
      line({ leafUuid: 'a2', sessionId: SESSION_ID, type: 'last-prompt' }),
    ].join('\n');

    const result = parseClaudeCodeSession(transcript)!;
    const assistant = result.messages[1];
    expect(assistant.content).toBe('the answer');
    expect(assistant.reasoning).toBeUndefined();
  });

  it('collects parallel tool_use results living on sibling branches of the trunk', () => {
    // a2/a3 are two tool_use lines of the same assistant turn; r1 answers the
    // first tool but hangs on a SIBLING branch (parent a2), while the trunk
    // continues a2 -> a3 -> r2 -> a4
    const transcript = [
      userRecord('u1', null, 'run two things'),
      assistantRecord('a2', 'u1', 'msg_1', {
        id: 'tool_A',
        input: { cmd: 'first' },
        name: 'Bash',
        type: 'tool_use',
      }),
      assistantRecord('a3', 'a2', 'msg_1', {
        id: 'tool_B',
        input: { cmd: 'second' },
        name: 'Bash',
        type: 'tool_use',
      }),
      toolResultRecord('r1', 'a2', 'tool_A', 'result A'),
      toolResultRecord('r2', 'a3', 'tool_B', 'result B'),
      assistantRecord('a4', 'r2', 'msg_2', { text: 'done', type: 'text' }),
      line({ leafUuid: 'a4', sessionId: SESSION_ID, type: 'last-prompt' }),
    ].join('\n');

    const result = parseClaudeCodeSession(transcript)!;
    const toolMessages = result.messages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages.map((m) => m.content)).toEqual(['result A', 'result B']);
    expect(toolMessages.map((m) => m.toolCallId)).toEqual(['tool_A', 'tool_B']);
    // both tool messages hang on the merged assistant message
    const assistant = result.messages.find((m) => (m.tools?.length ?? 0) > 0)!;
    expect(assistant.tools).toHaveLength(2);
    for (const toolMessage of toolMessages)
      expect(toolMessage.parentClientId).toBe(assistant.clientId);
  });

  it('walks the trunk through meta records and picks the last-prompt leaf', () => {
    // attachment record sits between user and assistant in the parent chain
    const transcript = [
      userRecord('u1', null, 'question'),
      line({
        isSidechain: false,
        parentUuid: 'u1',
        sessionId: SESSION_ID,
        type: 'attachment',
        uuid: 'att1',
      }),
      assistantRecord('a1', 'att1', 'msg_1', { text: 'abandoned branch', type: 'text' }),
      assistantRecord('a2', 'att1', 'msg_2', { text: 'current branch', type: 'text' }),
      line({ leafUuid: 'a2', sessionId: SESSION_ID, type: 'last-prompt' }),
    ].join('\n');

    const result = parseClaudeCodeSession(transcript)!;
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toBe('current branch');
    // the attachment is transparent: assistant parents to the user message
    expect(result.messages[1].parentClientId).toBe(`claude-code-u1`);
  });

  it('strips NUL characters and replaces embedded images with placeholders', () => {
    const nul = String.fromCodePoint(0);
    const transcript = [
      line({
        isSidechain: false,
        message: {
          content: [
            { text: `binary${nul}output`, type: 'text' },
            {
              source: { data: 'aGVsbG8=', media_type: 'image/png', type: 'base64' },
              type: 'image',
            },
          ],
          role: 'user',
        },
        parentUuid: null,
        sessionId: SESSION_ID,
        timestamp: '2026-07-01T00:00:00.000Z',
        type: 'user',
        uuid: 'u1',
      }),
      assistantRecord('a1', 'u1', 'msg_1', { text: 'ok', type: 'text' }),
      line({ leafUuid: 'a1', sessionId: SESSION_ID, type: 'last-prompt' }),
    ].join('\n');

    const result = parseClaudeCodeSession(transcript)!;
    expect(result.messages[0].content).toContain('binaryoutput');
    expect(result.messages[0].content).toContain('![imported image placeholder]');
    expect(result.imageCount).toBe(1);
  });

  it('parses sidechain records when the sidechain option is set', () => {
    const transcript = [
      line({
        agentId: 'sub1',
        isSidechain: true,
        message: { content: [{ text: 'subagent prompt', type: 'text' }], role: 'user' },
        parentUuid: null,
        sessionId: SESSION_ID,
        timestamp: '2026-07-01T00:00:00.000Z',
        type: 'user',
        uuid: 's1',
      }),
      line({
        agentId: 'sub1',
        isSidechain: true,
        message: {
          content: [{ text: 'subagent answer', type: 'text' }],
          id: 'msg_s1',
          model: 'claude-opus-4-8',
        },
        parentUuid: 's1',
        sessionId: SESSION_ID,
        timestamp: '2026-07-01T00:00:01.000Z',
        type: 'assistant',
        uuid: 's2',
      }),
    ].join('\n');

    expect(parseClaudeCodeSession(transcript)).toBeNull();
    const result = parseClaudeCodeSession(transcript, { sidechain: true })!;
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toBe('subagent answer');
  });

  it('tolerates corrupt lines and unknown record types', () => {
    const transcript = [
      'not json at all{{{',
      line({ operation: 'enqueue', sessionId: SESSION_ID, type: 'queue-operation' }),
      userRecord('u1', null, 'hi'),
      assistantRecord('a1', 'u1', 'msg_1', { text: 'hello', type: 'text' }),
      line({ leafUuid: 'a1', sessionId: SESSION_ID, type: 'last-prompt' }),
      line({ some: 'future-record-type', type: 'shiny-new-thing' }),
    ].join('\n');

    const result = parseClaudeCodeSession(transcript)!;
    expect(result.messages).toHaveLength(2);
  });

  it('returns null for transcripts without conversation', () => {
    expect(parseClaudeCodeSession('')).toBeNull();
    expect(
      parseClaudeCodeSession(
        line({ operation: 'enqueue', sessionId: SESSION_ID, type: 'queue-operation' }),
      ),
    ).toBeNull();
  });
});

describe('buildClaudeCodeImportPayload', () => {
  it('produces a payload with resume metadata and deterministic topic clientId', () => {
    const transcript = [
      userRecord('u1', null, 'hello'),
      assistantRecord('a1', 'u1', 'msg_1', { text: 'hi', type: 'text' }),
      line({ aiTitle: '打个招呼', sessionId: SESSION_ID, type: 'ai-title' }),
      line({ leafUuid: 'a1', sessionId: SESSION_ID, type: 'last-prompt' }),
    ].join('\n');

    const payload = buildClaudeCodeImportPayload(transcript)!;
    expect(payload.topicClientId).toBe(`claude-code-session-${SESSION_ID}`);
    expect(payload.source).toBe('claude-code');
    expect(payload.title).toBe('打个招呼');
    expect(payload.metadata).toEqual({
      heteroSessionId: SESSION_ID,
      heteroSessionIdByWorkingDirectory: { '/repo': SESSION_ID },
      importedFrom: 'claude-code-local',
    });
  });
});

describe('parseClaudeCodeSessionDigest', () => {
  it('extracts list metadata without building the payload', () => {
    const transcript = [
      userRecord('u1', null, 'first question'),
      assistantRecord('a1', 'u1', 'msg_1', { text: 'answer', type: 'text' }),
      line({ aiTitle: 'Digest title', sessionId: SESSION_ID, type: 'ai-title' }),
    ].join('\n');

    const digest = parseClaudeCodeSessionDigest(transcript, '/tmp/x.jsonl')!;
    expect(digest.sessionId).toBe(SESSION_ID);
    expect(digest.title).toBe('Digest title');
    expect(digest.firstPrompt).toBe('first question');
    expect(digest.messageCount).toBe(2);
    expect(digest.gitBranch).toBe('main');
    expect(digest.workingDirectory).toBe('/repo');
    expect(digest.source).toBe('claude-code');
    expect(digest.tokens).toBe(30); // 10 input + 20 output
  });

  it('counts tokens once per assistant message.id despite one line per block', () => {
    const transcript = [
      userRecord('u1', null, 'q'),
      assistantRecord('a1', 'u1', 'msg_1', { thinking: 't', type: 'thinking' }),
      assistantRecord('a2', 'a1', 'msg_1', { text: 'a', type: 'text' }),
      assistantRecord('a3', 'a2', 'msg_2', { text: 'b', type: 'text' }),
    ].join('\n');

    const digest = parseClaudeCodeSessionDigest(transcript, '/tmp/x.jsonl')!;
    // msg_1 counted once (not twice), plus msg_2
    expect(digest.tokens).toBe(60);
  });

  it('strips the injected Workspace preamble from title fallbacks', () => {
    const preambled =
      "## Workspace\nYou are running on the user's own machine. Your working directory is `/repo`.帮我修个 bug";
    const transcript = [
      userRecord('u1', null, preambled),
      assistantRecord('a1', 'u1', 'msg_1', { text: 'ok', type: 'text' }),
    ].join('\n');

    const digest = parseClaudeCodeSessionDigest(transcript, '/tmp/x.jsonl')!;
    expect(digest.firstPrompt).toBe('帮我修个 bug');
    expect(digest.title).toBe('帮我修个 bug');
  });
});

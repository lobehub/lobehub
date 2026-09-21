import { describe, expect, it } from 'vitest';

import { AgentStreamPipeline } from '../spawn/agentStreamPipeline';
import { buildClaudeCodeReplayTurn } from './replayClaudeCode';

const SESSION_ID = '03003604-e4aa-4c7c-ac24-86e4adcfca35';

const line = (record: Record<string, any>) => JSON.stringify(record);

const base = { cwd: '/repo', isSidechain: false, sessionId: SESSION_ID, version: '2.1.266' };

const userPrompt = (uuid: string, parentUuid: string | null, text: string) =>
  line({
    ...base,
    message: { content: text, role: 'user' },
    parentUuid,
    timestamp: '2026-09-21T02:00:00.000Z',
    type: 'user',
    uuid,
  });

const attachment = (uuid: string, parentUuid: string) =>
  line({ ...base, attachment: { type: 'environment' }, parentUuid, type: 'attachment', uuid });

const assistant = (
  uuid: string,
  parentUuid: string,
  msgId: string,
  block: Record<string, any>,
  stopReason: string,
  extra?: Record<string, any>,
) =>
  line({
    ...base,
    message: {
      content: [block],
      id: msgId,
      model: 'claude-opus-5',
      role: 'assistant',
      stop_reason: stopReason,
      type: 'message',
      usage: { input_tokens: 12, output_tokens: 34 },
    },
    parentUuid,
    timestamp: '2026-09-21T02:00:01.000Z',
    type: 'assistant',
    uuid,
    ...extra,
  });

const toolResult = (uuid: string, parentUuid: string, toolUseId: string, text: string) =>
  line({
    ...base,
    message: {
      content: [{ content: text, tool_use_id: toolUseId, type: 'tool_result' }],
      role: 'user',
    },
    parentUuid,
    timestamp: '2026-09-21T02:00:02.000Z',
    toolUseResult: { stdout: text },
    type: 'user',
    uuid,
  });

const bash = (id: string, command: string) => ({
  id,
  input: { command },
  name: 'Bash',
  type: 'tool_use',
});

/** Turn 1 finished normally; turn 2 is the one under test. */
const FIRST_TURN = [
  userPrompt('u1', null, 'first request'),
  attachment('a1', 'u1'),
  assistant('m1', 'a1', 'msg_1', { text: 'done with first', type: 'text' }, 'end_turn'),
];

const completedTranscript = [
  ...FIRST_TURN,
  userPrompt('u2', 'm1', 'second request'),
  attachment('a2', 'u2'),
  assistant(
    'm2a',
    'a2',
    'msg_2',
    { signature: 'sig', thinking: 'plan', type: 'thinking' },
    'tool_use',
  ),
  assistant('m2b', 'm2a', 'msg_2', bash('toolu_1', 'ls'), 'tool_use'),
  toolResult('r1', 'm2b', 'toolu_1', 'file-a\nfile-b'),
  attachment('a3', 'r1'),
  assistant('m3', 'a3', 'msg_3', { text: 'STEP1_OK', type: 'text' }, 'end_turn'),
  line({ leafUuid: 'm3', type: 'last-prompt' }),
].join('\n');

const interruptedTranscript = [
  ...FIRST_TURN,
  userPrompt('u2', 'm1', 'second request'),
  assistant('m2a', 'u2', 'msg_2', bash('toolu_1', 'ls'), 'tool_use'),
  toolResult('r1', 'm2a', 'toolu_1', 'file-a'),
  assistant('m3', 'r1', 'msg_3', bash('toolu_2', 'sleep 40'), 'tool_use'),
  line({ leafUuid: 'm3', type: 'last-prompt' }),
].join('\n');

describe('buildClaudeCodeReplayTurn', () => {
  it('replays only the last turn and reports it complete', () => {
    const turn = buildClaudeCodeReplayTurn(completedTranscript);

    expect(turn).not.toBeNull();
    expect(turn!.sessionId).toBe(SESSION_ID);
    expect(turn!.promptUuid).toBe('u2');
    expect(turn!.promptText).toBe('second request');
    expect(turn!.complete).toBe(true);
    // thinking + tool_use + tool_result + final text
    expect(turn!.recordCount).toBe(4);

    const parsed = turn!.lines.map((l) => JSON.parse(l));
    expect(parsed.map((p) => p.type)).toEqual([
      'system',
      'assistant',
      'assistant',
      'user',
      'assistant',
      'result',
    ]);
    expect(parsed[0]).toMatchObject({
      model: 'claude-opus-5',
      session_id: SESSION_ID,
      subtype: 'init',
    });
    // Nothing from the first turn leaks in.
    expect(turn!.lines.join('\n')).not.toContain('done with first');
    // Envelope fields are spelled the stream-json way.
    expect(parsed[3]).toMatchObject({
      session_id: SESSION_ID,
      tool_use_result: { stdout: 'file-a\nfile-b' },
      type: 'user',
    });
    expect(parsed[3].toolUseResult).toBeUndefined();
    expect(parsed.at(-1)).toMatchObject({
      is_error: false,
      result: 'STEP1_OK',
      subtype: 'success',
      usage: { input_tokens: 12, output_tokens: 34 },
    });
  });

  it('flags a turn cut off on a dangling tool_use as incomplete and emits no result', () => {
    const turn = buildClaudeCodeReplayTurn(interruptedTranscript);

    expect(turn!.complete).toBe(false);
    const parsed = turn!.lines.map((l) => JSON.parse(l));
    expect(parsed.map((p) => p.type)).toEqual(['system', 'assistant', 'user', 'assistant']);
    expect(parsed.some((p) => p.type === 'result')).toBe(false);
  });

  it('treats a turn that ended on an API error message as incomplete', () => {
    const transcript = [
      ...FIRST_TURN,
      userPrompt('u2', 'm1', 'second request'),
      assistant(
        'm2',
        'u2',
        'msg_2',
        { text: 'API Error: overloaded', type: 'text' },
        'stop_sequence',
        { isApiErrorMessage: true },
      ),
      line({ leafUuid: 'm2', type: 'last-prompt' }),
    ].join('\n');

    expect(buildClaudeCodeReplayTurn(transcript)!.complete).toBe(false);
  });

  it('pulls parallel tool results from sibling branches, in tool order', () => {
    const transcript = [
      ...FIRST_TURN,
      userPrompt('u2', 'm1', 'second request'),
      assistant('m2a', 'u2', 'msg_2', bash('toolu_a', 'ls a'), 'tool_use'),
      assistant('m2b', 'm2a', 'msg_2', bash('toolu_b', 'ls b'), 'tool_use'),
      // result B lands on the trunk, result A on a sibling branch
      toolResult('rb', 'm2b', 'toolu_b', 'out-b'),
      toolResult('ra', 'm2b', 'toolu_a', 'out-a'),
      assistant('m3', 'rb', 'msg_3', { text: 'both done', type: 'text' }, 'end_turn'),
      line({ leafUuid: 'm3', type: 'last-prompt' }),
    ].join('\n');

    const turn = buildClaudeCodeReplayTurn(transcript);
    const parsed = turn!.lines.map((l) => JSON.parse(l));
    const toolResultIds = parsed
      .filter((p) => p.type === 'user')
      .map((p) => p.message.content[0].tool_use_id);

    expect(turn!.complete).toBe(true);
    expect(toolResultIds).toEqual(['toolu_a', 'toolu_b']);
    expect(parsed.filter((p) => p.uuid === 'ra')).toHaveLength(1);
  });

  it('does not anchor on the meta follow-up the CLI injects after an interrupt', () => {
    const transcript = [
      ...FIRST_TURN,
      userPrompt('u2', 'm1', 'second request'),
      assistant('m2', 'u2', 'msg_2', bash('toolu_1', 'sleep 40'), 'tool_use'),
      line({
        ...base,
        message: {
          content: [
            {
              content: '[Request interrupted by user for tool use]',
              tool_use_id: 'toolu_1',
              type: 'tool_result',
            },
          ],
          role: 'user',
        },
        parentUuid: 'm2',
        toolDenialKind: 'interrupt',
        type: 'user',
        uuid: 'r1',
      }),
      line({
        ...base,
        isMeta: true,
        message: {
          content: [{ text: '[Request interrupted by user]', type: 'text' }],
          role: 'user',
        },
        parentUuid: 'r1',
        type: 'user',
        uuid: 'meta1',
      }),
      line({ leafUuid: 'meta1', type: 'last-prompt' }),
    ].join('\n');

    const turn = buildClaudeCodeReplayTurn(transcript);

    expect(turn!.promptUuid).toBe('u2');
    expect(turn!.complete).toBe(false);
  });

  it('returns null without a user prompt or session id', () => {
    expect(buildClaudeCodeReplayTurn('')).toBeNull();
    expect(buildClaudeCodeReplayTurn(line({ type: 'ai-title', aiTitle: 'x' }))).toBeNull();
    expect(
      buildClaudeCodeReplayTurn(
        assistant('m1', 'x', 'msg_1', { text: 'orphan', type: 'text' }, 'end_turn'),
      ),
    ).toBeNull();
  });

  it('drives the real Claude Code adapter like a live process would', async () => {
    const turn = buildClaudeCodeReplayTurn(completedTranscript)!;
    const pipeline = new AgentStreamPipeline({ agentType: 'claude-code', operationId: 'op-1' });

    const events = [];
    for (const l of turn.lines) events.push(...(await pipeline.push(`${l}\n`)));
    events.push(...(await pipeline.flush()));

    const types = events.map((e) => e.type);
    expect(pipeline.sessionId).toBe(SESSION_ID);
    expect(types[0]).toBe('stream_start');
    expect(types).toContain('tool_start');
    expect(types).toContain('tool_end');
    expect(types).toContain('stream_chunk');
    expect(types.at(-1)).toBe('agent_runtime_end');

    const toolEnd = events.find((e) => e.type === 'tool_end') as any;
    expect(toolEnd.data.toolCallId).toBe('toolu_1');
    expect(toolEnd.data.isSuccess).toBe(true);
  });

  it('leaves the dangling tool unsuccessful and no runtime end for a cut-off turn', async () => {
    const turn = buildClaudeCodeReplayTurn(interruptedTranscript)!;
    const pipeline = new AgentStreamPipeline({ agentType: 'claude-code', operationId: 'op-1' });

    const events = [];
    for (const l of turn.lines) events.push(...(await pipeline.push(`${l}\n`)));
    events.push(...(await pipeline.flush()));

    const types = events.map((e) => e.type);
    expect(types).not.toContain('agent_runtime_end');
    const toolEnds = events.filter((e) => e.type === 'tool_end') as any[];
    expect(toolEnds.map((e) => [e.data.toolCallId, e.data.isSuccess])).toEqual([
      ['toolu_1', true],
      ['toolu_2', false],
    ]);
  });
});

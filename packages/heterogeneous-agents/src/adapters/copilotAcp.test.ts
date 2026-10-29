import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { HeterogeneousAgentEvent } from '../types';
import { CopilotAcpAdapter } from './copilotAcp';

const FIXTURES = new URL('../spawn/__fixtures__/copilotAcp/', import.meta.url);

const scenarios = JSON.parse(readFileSync(new URL('scenarios.json', FIXTURES), 'utf8'))
  .scenarios as Record<string, { result: Record<string, unknown> }>;

/** The `session/update` payloads `copilot --acp` 1.0.105 streamed for one recorded turn. */
const updatesOf = (fixture: string): Record<string, unknown>[] =>
  readFileSync(new URL(`${fixture}.jsonl`, FIXTURES), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((frame) => frame.method === 'session/update')
    .map((frame) => frame.params.update);

/** Feed a recorded turn through the adapter the way `CopilotAcpSession` does. */
const replay = (fixture: string, result = scenarios[fixture]!.result) => {
  const adapter = new CopilotAcpAdapter();
  const events = [
    ...adapter.adapt({ sessionId: 'copilot-session-1', type: 'copilot_session' }),
    ...updatesOf(fixture).flatMap((update) => adapter.adapt(update)),
    ...adapter.adapt({ ...result, type: 'copilot_prompt_completed' }),
    ...adapter.flush(),
  ];
  return { adapter, events };
};

const ofType = (events: HeterogeneousAgentEvent[], type: HeterogeneousAgentEvent['type']) =>
  events.filter((event) => event.type === type).map((event) => event.data);

const mainText = (events: HeterogeneousAgentEvent[]) =>
  events
    .filter(
      (event) =>
        event.type === 'stream_chunk' && event.data.chunkType === 'text' && !event.data.subagent,
    )
    .map((event) => event.data.content)
    .join('');

const toolLifecycle = (events: HeterogeneousAgentEvent[], toolCallId: string) =>
  events
    .filter((event) => event.data?.toolCallId === toolCallId && event.type !== 'stream_chunk')
    .map((event) => event.type);

describe('CopilotAcpAdapter', () => {
  it('maps a real GitHub-backed turn: text, read and shell tools, usage', () => {
    const { events } = replay('acp-github-tool-turn');

    for (const toolCallId of ['call_Mmv92wCSvmVcwD9b0dwiuzb3', 'call_WR3KchaI4SAyaV9mzjaorzFD']) {
      // One raw tool item → one stable payload id across start, result and end.
      expect(toolLifecycle(events, toolCallId)).toEqual(['tool_start', 'tool_result', 'tool_end']);
    }
    const [read, shell] = ofType(events, 'tool_result');
    // `view` reports its result only in rawOutput.content.
    expect(read).toMatchObject({
      content: 'probe-line-1: copilot acp fixture\nprobe-line-2: second line\n',
      isError: false,
    });
    expect(shell.content).toBe('copilot-acp-probe\nLinux\n<shellId: 0 completed with exit code 0>');
    expect(ofType(events, 'tool_start').map(({ toolCalling }) => toolCalling)).toEqual([
      expect.objectContaining({
        apiName: 'Viewing /tmp/copilot-probe-cwd/notes.txt',
        arguments: JSON.stringify({ path: '/tmp/copilot-probe-cwd/notes.txt' }),
        identifier: 'copilot',
      }),
      expect.objectContaining({ apiName: 'Run requested shell command', identifier: 'copilot' }),
    ]);

    // No messageId: each finished tool batch opens the next step.
    expect(ofType(events, 'stream_start')).toEqual([
      expect.objectContaining({ provider: 'copilot', sessionId: 'copilot-session-1' }),
      expect.objectContaining({ newStep: true }),
      expect.objectContaining({ newStep: true }),
    ]);
    expect(mainText(events)).toBe(
      'probe-line-1: copilot acp fixture\n\n```text\ncopilot-acp-probe\nLinux\n```',
    );
    expect(ofType(events, 'step_complete')).toEqual([
      expect.objectContaining({
        phase: 'turn_metadata',
        provider: 'copilot',
        // Copilot's inputTokens (37,617) already include the cache reads and
        // writes, so they must not be added again.
        usage: {
          inputCachedTokens: 25_008,
          inputCacheMissTokens: 37_617 - 25_008 - 12_600,
          inputWriteCacheTokens: 12_600,
          outputTextTokens: 90,
          totalInputTokens: 37_617,
          totalOutputTokens: 90,
          totalTokens: 37_707,
        },
      }),
    ]);
    expect(events.at(-1)).toMatchObject({
      data: { stopReason: 'end_turn' },
      type: 'agent_runtime_end',
    });
  });

  it.each(['acp-byok-openai-tool-turn', 'acp-byok-anthropic-tool-turn'])(
    'streams BYOK reasoning as thoughts (%s)',
    (fixture) => {
      const { events } = replay(fixture);
      const reasoning = events
        .filter((event) => event.type === 'stream_chunk' && event.data.chunkType === 'reasoning')
        .map((event) => event.data.reasoning);

      expect(reasoning[0]).toBe('I should read notes.txt first.');
      expect(ofType(events, 'tool_result')).toHaveLength(2);
      expect(ofType(events, 'error')).toEqual([]);
    },
  );

  it('reports a rejected shell command as a failed tool and keeps the notice as text', () => {
    const { events } = replay('acp-permission-reject');

    expect(toolLifecycle(events, 'call_mock_10')).toEqual([
      'tool_start',
      'tool_result',
      'tool_end',
    ]);
    expect(ofType(events, 'tool_result').at(-1)).toEqual({
      content: 'The user rejected this tool call.',
      isError: true,
      toolCallId: 'call_mock_10',
    });
    expect(ofType(events, 'tool_end').at(-1)).toMatchObject({ isSuccess: false });
    expect(mainText(events)).toContain('Info: Operation cancelled by user');
  });

  it.each([
    ['acp-cancel-during-tool', 'call_mock_7'],
    ['acp-cancel-at-permission', 'call_mock_8'],
  ])('closes the tool Copilot leaves open when a turn is cancelled (%s)', (fixture, toolCallId) => {
    const { events } = replay(fixture);

    expect(toolLifecycle(events, toolCallId)).toEqual(['tool_start', 'tool_result', 'tool_end']);
    expect(ofType(events, 'tool_result')).toEqual([
      { content: 'Cancelled before the tool finished.', isError: true, toolCallId },
    ]);
    expect(ofType(events, 'tool_end')).toEqual([{ isSuccess: false, toolCallId }]);
    expect(events.at(-1)).toMatchObject({
      data: { reason: 'interrupted', stopReason: 'cancelled' },
      type: 'agent_runtime_end',
    });
  });

  it('keeps text that was already in flight when the cancel landed', () => {
    const { events } = replay('acp-github-cancel');

    expect(mainText(events)).toMatch(/^1\n2\n3[\S\s]*\n113$/);
    expect(ofType(events, 'tool_result')).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      data: { reason: 'interrupted' },
      type: 'agent_runtime_end',
    });
  });

  it('keeps unmarked subagent chunks and tools in the task thread', () => {
    const { events } = replay('acp-subagent');
    const subagentEvents = events.filter((event) => event.data?.subagent);

    expect(mainText(events)).toBe(
      'Delegating to a subagent.The subagent reported the first line (mock main agent).',
    );
    // The task itself is a main tool; its result is main-scoped and ends the run.
    expect(toolLifecycle(events, 'call_mock_3')).toEqual(['tool_start', 'tool_result', 'tool_end']);
    expect(
      events.find(
        (event) => event.type === 'tool_result' && event.data.toolCallId === 'call_mock_3',
      )?.data,
    ).toEqual({
      content: 'Subagent: first line is probe-line-1.',
      isError: false,
      toolCallId: 'call_mock_3',
    });

    expect(subagentEvents.map((event) => event.data.subagent.parentToolCallId)).toEqual(
      subagentEvents.map(() => 'call_mock_3'),
    );
    expect(subagentEvents[0]!.data.subagent.spawnMetadata).toEqual({
      description: 'Inspect notes file',
      prompt: 'Read /tmp/copilot-probe-cwd/notes.txt and report its first line.',
      subagentType: 'explore',
    });
    expect(subagentEvents.slice(1).some((event) => event.data.subagent.spawnMetadata)).toBe(false);
    expect(toolLifecycle(events, 'call_mock_4')).toEqual(['tool_start', 'tool_result', 'tool_end']);

    const subagentText = subagentEvents
      .filter((event) => event.type === 'stream_chunk' && event.data.chunkType === 'text')
      .map((event) => [event.data.subagent.subagentMessageId, event.data.content]);
    // The subagent's read result closes its first round.
    expect(subagentText).toEqual([
      ['copilot:call_mock_3:1', 'Reading note'],
      ['copilot:call_mock_3:1', 's.txt first.'],
      ['copilot:call_mock_3:2', 'Subagent: fi'],
      ['copilot:call_mock_3:2', 'rst line is '],
      ['copilot:call_mock_3:2', 'probe-line-1'],
      ['copilot:call_mock_3:2', '.'],
    ]);
  });

  it('treats sql todo tools and their empty plan update as ordinary main work', () => {
    const { events } = replay('acp-plan');

    expect(events.some((event) => event.data?.subagent)).toBe(false);
    expect(ofType(events, 'tool_result').map(({ toolCallId }) => toolCallId)).toEqual([
      'call_mock_0',
      'call_mock_1',
    ]);
    expect(mainText(events)).toBe('Planning the work.Marking progress.Plan recorded (mock).');
  });

  it('turns provider retries into stream_retry and the final notice into an error', () => {
    const { events } = replay('acp-provider-error');

    expect(ofType(events, 'stream_retry')).toEqual([
      expect.objectContaining({ agentType: 'copilot', attempt: 1 }),
      expect.objectContaining({ agentType: 'copilot', attempt: 2 }),
    ]);
    expect(mainText(events)).toBe('');
    expect(ofType(events, 'error')).toEqual([
      expect.objectContaining({
        agentType: 'copilot',
        message: expect.stringMatching(
          /^Authentication failed with provider at http:\/\/127\.0\.0\.1:18801\/v1 \(HTTP 401\)\./,
        ),
      }),
    ]);
    expect(ofType(events, 'agent_runtime_end')).toEqual([]);
  });

  it('keeps an answer that merely starts with "Error: " as text', () => {
    const adapter = new CopilotAcpAdapter();
    const chunk = (text: string) => ({
      content: { text, type: 'text' },
      sessionUpdate: 'agent_message_chunk',
    });
    const events = [
      ...adapter.adapt(chunk('Error: the test fails because ')),
      ...adapter.adapt(chunk('the fixture is stale.')),
      ...adapter.adapt({
        stopReason: 'end_turn',
        type: 'copilot_prompt_completed',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
    ];

    expect(mainText(events)).toBe('Error: the test fails because the fixture is stale.');
    expect(ofType(events, 'error')).toEqual([]);
  });

  it('drops the token-estimate notice Copilot streams for a model outside its catalog', () => {
    const adapter = new CopilotAcpAdapter();
    const chunk = (text: string) => ({
      content: { text, type: 'text' },
      sessionUpdate: 'agent_message_chunk',
    });
    // Streamed by copilot --acp 1.0.105 before the first request to a LobeHub server-default model.
    const notice =
      'Warning: No token count multiplier is known for Anthropic model "lobehub/claude-sonnet-4-6". ' +
      'Token estimates will use the 1.0 fallback; configure a recognized canonical model ID to ' +
      'enable model-specific token counting.';
    const events = [
      ...adapter.adapt(chunk(notice)),
      ...adapter.adapt({ size: 128_000, sessionUpdate: 'usage_update', used: 10_875 }),
      ...adapter.adapt(chunk('LOBEHUB_RELAY_OK')),
    ];

    expect(mainText(events)).toBe('LOBEHUB_RELAY_OK');
  });

  it('emits nothing after the turn has ended', () => {
    const { adapter } = replay('acp-cancel-midstream');

    expect(
      adapter.adapt({
        content: { text: 'late', type: 'text' },
        sessionUpdate: 'agent_message_chunk',
      }),
    ).toEqual([]);
    expect(adapter.flush()).toEqual([]);
  });
});

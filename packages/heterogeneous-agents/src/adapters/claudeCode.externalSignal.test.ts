import { describe, expect, it } from 'vitest';

import { ClaudeCodeAdapter, ClaudeCodeSdkAdapter } from '.';

describe('ClaudeCodeAdapter', () => {
  // ────────────────────────────────────────────────────
  // external signal detection (Monitor task callbacks)
  // ────────────────────────────────────────────────────
  describe('external signal detection ()', () => {
    const init = (adapter: ClaudeCodeAdapter) => {
      adapter.adapt({
        model: 'claude-sonnet-4-6',
        session_id: 'sess_1',
        subtype: 'init',
        type: 'system',
      });
    };

    const ccUser = (toolCallId: string, content: string) => ({
      message: {
        content: [{ content, tool_use_id: toolCallId, type: 'tool_result' }],
      },
      type: 'user',
    });
    const ccMessageStart = (msgId: string) => ({
      event: { message: { id: msgId, model: 'claude-sonnet-4-6' }, type: 'message_start' },
      type: 'stream_event',
    });
    const ccTaskStarted = (taskId: string, toolUseId: string) => ({
      session_id: 'sess_1',
      subtype: 'task_started',
      task_id: taskId,
      tool_use_id: toolUseId,
      type: 'system',
    });
    const ccTaskNotification = (taskId: string) => ({
      session_id: 'sess_1',
      subtype: 'task_notification',
      task_id: taskId,
      type: 'system',
    });

    /**
     * Real-world Monitor flow recorded from `claude -p` against the
     * Monitor skill:
     *   1. LLM emits Monitor tool_use → adapter notes the name
     *   2. CC emits `system task_started` (Monitor registers as a task)
     *   3. user event with tool_result (initial "Monitor started" ack)
     *   4. Assistant turn opens, LLM writes confirmation toolless reply
     *   5. RESULT — turn ends, no new user input arrives
     *   6. SYSTEM init + assistant message_start — Monitor's stdout
     *      pushed and CC re-invoked the LLM. THIS turn is a signal callback.
     */
    it('attaches externalSignal when a new turn opens without user input while a task is active', () => {
      const adapter = new ClaudeCodeAdapter();
      init(adapter);

      // Step 0: Monitor tool_use
      adapter.adapt({
        message: {
          content: [
            { id: 'toolu_mon', input: { shell: 'every 1s' }, name: 'Monitor', type: 'tool_use' },
          ],
          id: 'msg_01',
        },
        type: 'assistant',
      });

      // CC registers the long-running task
      adapter.adapt(ccTaskStarted('task_1', 'toolu_mon'));

      // Initial tool_result (LLM's natural follow-up turn — NOT a signal callback)
      adapter.adapt(ccUser('toolu_mon', 'Monitor started'));

      // Step 1: natural confirmation turn — opens AFTER the user event,
      // so it consumes `hasUnhandledUserInput` and is NOT signal-tagged.
      const confirm = adapter.adapt(ccMessageStart('msg_02'));
      const confirmStart = confirm.find((e) => e.type === 'stream_start' && e.data?.newStep);
      expect(confirmStart!.data.externalSignal).toBeUndefined();

      // Step 2: Monitor pushed an event → CC re-invokes the LLM without
      // any new user message. A signal callback.
      const cb1 = adapter.adapt(ccMessageStart('msg_03'));
      const cb1Start = cb1.find((e) => e.type === 'stream_start' && e.data?.newStep);
      expect(cb1Start!.data.externalSignal).toEqual({
        sequence: 1,
        sourceToolCallId: 'toolu_mon',
        sourceToolName: 'Monitor',
        type: 'tool-stdout',
      });
    });

    // Regression (P2): on the BATCH path, when the post-tool confirmation REUSES
    // the Monitor tool's message.id, the forced split must still consume
    // `hasUnhandledUserInput` (armed by the tool_result). Otherwise the stale
    // flag survives and the next callback turn — opened while the task is active
    // with no new user input — fails the `!hasUnhandledUserInput` signal check,
    // leaving the first stdout callback untagged.
    it('still tags the next callback after a forced post-tool split reuses the tool id (batch Monitor flow)', () => {
      const adapter = new ClaudeCodeAdapter();
      init(adapter);

      // Monitor tool_use under msg_01 (batch: an `assistant` event, not a delta).
      adapter.adapt({
        message: {
          content: [
            { id: 'toolu_mon', input: { shell: 'every 1s' }, name: 'Monitor', type: 'tool_use' },
          ],
          id: 'msg_01',
        },
        type: 'assistant',
      });
      adapter.adapt(ccTaskStarted('task_1', 'toolu_mon'));
      // tool_result → arms hasUnhandledUserInput.
      adapter.adapt(ccUser('toolu_mon', 'Monitor started'));

      // Confirmation turn REUSES msg_01 → forced post-tool split. It is the
      // natural follow-up to the tool_result, so it carries no signal AND must
      // consume hasUnhandledUserInput.
      const confirm = adapter.adapt({
        message: {
          id: 'msg_01',
          content: [{ text: 'mock monitoring confirmation', type: 'text' }],
        },
        type: 'assistant',
      });
      const confirmStart = confirm.find((e) => e.type === 'stream_start' && e.data?.newStep);
      expect(confirmStart).toBeDefined();
      expect(confirmStart!.data.externalSignal).toBeUndefined();

      // Monitor pushes an event → CC re-invokes with a NEW id and no new user
      // input. This callback must be signal-tagged — only true once the forced
      // split cleared the stale flag.
      const cb1 = adapter.adapt({
        message: { id: 'msg_02', content: [{ text: 'mock callback turn', type: 'text' }] },
        type: 'assistant',
      });
      const cb1Start = cb1.find((e) => e.type === 'stream_start' && e.data?.newStep);
      expect(cb1Start!.data.externalSignal).toEqual({
        sequence: 1,
        sourceToolCallId: 'toolu_mon',
        sourceToolName: 'Monitor',
        type: 'tool-stdout',
      });
    });

    it('keeps tagging consecutive signal callbacks with incrementing sequence', () => {
      const adapter = new ClaudeCodeAdapter();
      init(adapter);

      adapter.adapt({
        message: {
          content: [{ id: 'toolu_mon', input: {}, name: 'Monitor', type: 'tool_use' }],
          id: 'msg_01',
        },
        type: 'assistant',
      });
      adapter.adapt(ccTaskStarted('task_1', 'toolu_mon'));
      adapter.adapt(ccUser('toolu_mon', 'Monitor started'));
      adapter.adapt(ccMessageStart('msg_02')); // confirmation turn (no signal)

      const sequences: (number | undefined)[] = [];
      for (let i = 3; i <= 5; i++) {
        const ev = adapter.adapt(ccMessageStart(`msg_0${i}`));
        const start = ev.find((e) => e.type === 'stream_start' && e.data?.newStep);
        sequences.push(start!.data.externalSignal?.sequence);
      }
      expect(sequences).toEqual([1, 2, 3]);
    });

    it('tags the post-task summary turn with `task-completion` after `task_notification`', () => {
      const adapter = new ClaudeCodeAdapter();
      init(adapter);

      adapter.adapt({
        message: {
          content: [{ id: 'toolu_mon', input: {}, name: 'Monitor', type: 'tool_use' }],
          id: 'msg_01',
        },
        type: 'assistant',
      });
      adapter.adapt(ccTaskStarted('task_1', 'toolu_mon'));
      adapter.adapt(ccUser('toolu_mon', 'Monitor started'));
      adapter.adapt(ccMessageStart('msg_02')); // confirmation (no signal)

      // One signal callback while task is alive
      const cb1 = adapter.adapt(ccMessageStart('msg_03'));
      expect(
        cb1.find((e) => e.type === 'stream_start' && e.data?.newStep)!.data.externalSignal,
      ).toEqual({
        sequence: 1,
        sourceToolCallId: 'toolu_mon',
        sourceToolName: 'Monitor',
        type: 'tool-stdout',
      });

      // Task ends
      adapter.adapt(ccTaskNotification('task_1'));

      // Next turn — task ended, but the post-task summary keeps the
      // source-tool lineage so MessageCollector can render it inside
      // the same AssistantGroup as the preceding callbacks.
      const after = adapter.adapt(ccMessageStart('msg_04'));
      expect(
        after.find((e) => e.type === 'stream_start' && e.data?.newStep)!.data.externalSignal,
      ).toEqual({
        sourceToolCallId: 'toolu_mon',
        sourceToolName: 'Monitor',
        type: 'task-completion',
      });

      // The completion tag is one-shot — a subsequent turn (e.g. if CC
      // spawned another LLM call) must not inherit it.
      const followUp = adapter.adapt(ccMessageStart('msg_05'));
      expect(
        followUp.find((e) => e.type === 'stream_start' && e.data?.newStep)!.data.externalSignal,
      ).toBeUndefined();
    });

    it('treats SDK background Bash completion notification as task-completion lineage', () => {
      const adapter = new ClaudeCodeSdkAdapter();
      init(adapter);

      adapter.adapt({
        message: {
          content: [
            {
              id: 'toolu_bash',
              input: { command: 'sleep 1 && echo done', run_in_background: true },
              name: 'Bash',
              type: 'tool_use',
            },
          ],
          id: 'msg_01',
        },
        type: 'assistant',
      });
      adapter.adapt(ccTaskStarted('task_1', 'toolu_bash'));
      adapter.adapt(ccUser('toolu_bash', 'Background command started'));

      const firstResult = adapter.adapt({
        is_error: false,
        result: 'Background command started',
        type: 'result',
      });
      expect(firstResult.map((e) => e.type)).toEqual(['stream_end']);

      adapter.adapt(ccTaskNotification('task_1'));

      const completion = adapter.adapt(ccMessageStart('msg_02'));
      expect(
        completion.find((e) => e.type === 'stream_start' && e.data?.newStep)!.data.externalSignal,
      ).toEqual({
        sourceToolCallId: 'toolu_bash',
        sourceToolName: 'Bash',
        type: 'task-completion',
      });
    });

    /**
     * Real-world regression (a production topic): two background subagents ran at
     * once. `Agent` runs in the background by default, so neither call carried
     * `run_in_background`. When the first finished, its wake-up turn was tagged
     * as a `tool-stdout` callback of the OTHER, still-running subagent.
     */
    it('attributes each background Agent wake-up to the subagent that finished', () => {
      const adapter = new ClaudeCodeSdkAdapter();
      init(adapter);

      const agentCall = (id: string) => ({
        id,
        input: { description: id, prompt: 'research', subagent_type: 'Explore' },
        name: 'Agent',
        type: 'tool_use',
      });
      adapter.adapt({
        message: { content: [agentCall('toolu_srv'), agentCall('toolu_fe')], id: 'msg_01' },
        type: 'assistant',
      });
      adapter.adapt(ccTaskStarted('task_srv', 'toolu_srv'));
      adapter.adapt(ccTaskStarted('task_fe', 'toolu_fe'));
      adapter.adapt(ccUser('toolu_srv', 'Async agent launched successfully.'));
      adapter.adapt(ccUser('toolu_fe', 'Async agent launched successfully.'));
      adapter.adapt(ccMessageStart('msg_02')); // "both still running" reply
      adapter.adapt({ is_error: false, result: 'running', type: 'result' });

      const signalOf = (events: ReturnType<typeof adapter.adapt>) =>
        events.find((e) => e.type === 'stream_start' && e.data?.newStep)!.data.externalSignal;

      adapter.adapt(ccTaskNotification('task_srv'));
      expect(signalOf(adapter.adapt(ccMessageStart('msg_03')))).toEqual({
        sourceToolCallId: 'toolu_srv',
        sourceToolName: 'Agent',
        type: 'task-completion',
      });
      adapter.adapt({ is_error: false, result: 'one done', type: 'result' });

      adapter.adapt(ccTaskNotification('task_fe'));
      expect(signalOf(adapter.adapt(ccMessageStart('msg_04')))).toEqual({
        sourceToolCallId: 'toolu_fe',
        sourceToolName: 'Agent',
        type: 'task-completion',
      });
    });

    it('drops a task completion the next natural turn already answered', () => {
      const adapter = new ClaudeCodeSdkAdapter();
      init(adapter);

      // A Monitor stays alive for the whole run.
      adapter.adapt({
        message: {
          content: [{ id: 'toolu_mon', input: {}, name: 'Monitor', type: 'tool_use' }],
          id: 'msg_01',
        },
        type: 'assistant',
      });
      adapter.adapt(ccTaskStarted('task_mon', 'toolu_mon'));
      adapter.adapt(ccUser('toolu_mon', 'Monitor started'));

      // A background Bash starts and finishes while the run is still busy.
      adapter.adapt({
        message: {
          content: [
            {
              id: 'toolu_bg',
              input: { command: 'sleep 1', run_in_background: true },
              name: 'Bash',
              type: 'tool_use',
            },
          ],
          id: 'msg_02',
        },
        type: 'assistant',
      });
      adapter.adapt(ccTaskStarted('task_bg', 'toolu_bg'));
      adapter.adapt(ccUser('toolu_bg', 'Background command started'));
      adapter.adapt(ccTaskNotification('task_bg'));
      // The tool_result follow-up delivers the finished task's notification.
      adapter.adapt(ccMessageStart('msg_03'));

      // The next wake-up comes from the Monitor, not the finished Bash.
      const cb = adapter.adapt(ccMessageStart('msg_04'));
      expect(
        cb.find((e) => e.type === 'stream_start' && e.data?.newStep)!.data.externalSignal,
      ).toEqual({
        sequence: 1,
        sourceToolCallId: 'toolu_mon',
        sourceToolName: 'Monitor',
        type: 'tool-stdout',
      });
    });

    /**
     * Real-world regression (recorded on tpc_joZS2mksoY5L): a slow `git commit`
     * (running a lint-staged hook) makes CC track the Bash call as a task and
     * emit `task_started` + `task_notification` back-to-back, with NO out-of-band
     * callback turn in between, immediately followed by the tool_result. That is
     * an inline synchronous tool, not a Monitor-style long-running task — the next
     * turn is the normal main-chain continuation and must NOT be tagged
     * `task-completion` (doing so mis-anchors it and drops it from the rendered
     * chain).
     */
    it('does NOT tag the next turn when a task started and ended with no callbacks (inline tool)', () => {
      const adapter = new ClaudeCodeAdapter();
      init(adapter);

      // A Bash `git commit` tool_use.
      adapter.adapt({
        message: {
          content: [
            {
              id: 'toolu_commit',
              input: { command: 'git commit' },
              name: 'Bash',
              type: 'tool_use',
            },
          ],
          id: 'msg_01',
        },
        type: 'assistant',
      });

      // CC tracks the slow commit as a task, then notifies completion
      // back-to-back — NO callback turn opened while it was alive.
      adapter.adapt(ccTaskStarted('task_1', 'toolu_commit'));
      adapter.adapt(ccTaskNotification('task_1'));

      // The commit's tool_result is consumed inline by the next turn.
      adapter.adapt(ccUser('toolu_commit', 'committed'));

      // Next turn is plain continuation — must carry NO externalSignal.
      const next = adapter.adapt(ccMessageStart('msg_02'));
      expect(
        next.find((e) => e.type === 'stream_start' && e.data?.newStep)!.data.externalSignal,
      ).toBeUndefined();
    });

    it('clears unconsumed task-completion lineage on `result`', () => {
      const adapter = new ClaudeCodeAdapter();
      init(adapter);

      adapter.adapt({
        message: {
          content: [{ id: 'toolu_mon', input: {}, name: 'Monitor', type: 'tool_use' }],
          id: 'msg_01',
        },
        type: 'assistant',
      });
      adapter.adapt(ccTaskStarted('task_1', 'toolu_mon'));
      adapter.adapt(ccUser('toolu_mon', 'Monitor started'));
      adapter.adapt(ccMessageStart('msg_02'));
      // A signal callback fires while the task is alive (callbackCount > 0), so
      // `task_notification` genuinely arms pendingTaskCompletion — otherwise (an
      // inline tool with no callbacks) nothing is armed and this test would pass
      // vacuously, no longer guarding the `result` clear path.
      adapter.adapt(ccMessageStart('msg_03'));
      adapter.adapt(ccTaskNotification('task_1'));
      // Run ends before the summary turn fires (unusual but possible).
      adapter.adapt({ result: 'ok', type: 'result', usage: undefined });

      // A later turn (e.g. follow-up user message) must NOT inherit
      // the unconsumed task-completion lineage — `result` dropped it.
      const next = adapter.adapt(ccMessageStart('msg_04'));
      expect(
        next.find((e) => e.type === 'stream_start' && e.data?.newStep)!.data.externalSignal,
      ).toBeUndefined();
    });

    it('does NOT trigger from subagent inner user events', () => {
      const adapter = new ClaudeCodeAdapter();
      init(adapter);

      // Main agent fires Monitor, then registers task
      adapter.adapt({
        message: {
          content: [{ id: 'toolu_mon', input: {}, name: 'Monitor', type: 'tool_use' }],
          id: 'msg_01',
        },
        type: 'assistant',
      });
      adapter.adapt(ccTaskStarted('task_1', 'toolu_mon'));
      adapter.adapt(ccUser('toolu_mon', 'Monitor started'));
      adapter.adapt(ccMessageStart('msg_02')); // confirmation (no signal)

      // Subagent inner tool_result fires WITH parent_tool_use_id — must
      // NOT reset hasUnhandledUserInput; the next main-chain turn is
      // still a signal callback.
      adapter.adapt({
        message: {
          content: [{ content: 'inner', tool_use_id: 'toolu_inner', type: 'tool_result' }],
        },
        parent_tool_use_id: 'toolu_other',
        type: 'user',
      });

      const ev = adapter.adapt(ccMessageStart('msg_03'));
      expect(
        ev.find((e) => e.type === 'stream_start' && e.data?.newStep)!.data.externalSignal,
      ).toBeDefined();
    });
  });
});

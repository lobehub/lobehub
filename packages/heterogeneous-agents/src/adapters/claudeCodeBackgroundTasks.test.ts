import { describe, expect, it } from 'vitest';

import type { BackgroundTaskEventData, HeterogeneousAgentEvent } from '../types';
import { ClaudeCodeAdapter, ClaudeCodeSdkAdapter, CodeBuddyAdapter } from '.';

// Shapes recorded from `claude -p --output-format stream-json` 2.1.308.
const OUTPUT = '/tmp/claude-501/proj/sess/tasks/bys1w0wxo.output';

const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({
  message: { content: [{ id, input, name, type: 'tool_use' }], id: `msg_${id}` },
  type: 'assistant',
});

const taskStarted = (overrides: Record<string, unknown> = {}) => ({
  description: 'Run 60 pings to localhost in background',
  is_backgrounded: true,
  run_id: 'run_1',
  session_id: 'sess_1',
  subtype: 'task_started',
  task_id: 'bys1w0wxo',
  task_type: 'local_bash',
  tool_use_id: 'toolu_bash',
  type: 'system',
  ...overrides,
});

const toolResult = (toolUseId: string, content: string) => ({
  message: { content: [{ content, tool_use_id: toolUseId, type: 'tool_result' }] },
  type: 'user',
});

const notification = (overrides: Record<string, unknown> = {}) => ({
  output_file: OUTPUT,
  session_id: 'sess_1',
  status: 'completed',
  subtype: 'task_notification',
  summary: 'Run 60 pings to localhost in background',
  task_id: 'bys1w0wxo',
  tool_use_id: 'toolu_bash',
  type: 'system',
  ...overrides,
});

const snapshots = (events: HeterogeneousAgentEvent[]): BackgroundTaskEventData[] =>
  events.filter((e) => e.type === 'background_task').map((e) => e.data);

const startBackgroundBash = (adapter: ClaudeCodeAdapter) => {
  adapter.adapt(toolUse('toolu_bash', 'Bash', { command: 'ping -c 60 127.0.0.1' }));
  return snapshots(adapter.adapt(taskStarted()));
};

describe('Claude Code background tasks', () => {
  it('reports a background Bash from start to its notification', () => {
    const adapter = new ClaudeCodeAdapter();

    const [started] = startBackgroundBash(adapter);
    expect(started).toEqual({
      task: {
        description: 'Run 60 pings to localhost in background',
        startedAt: expect.any(Number),
        status: 'running',
        taskId: 'bys1w0wxo',
        taskType: 'local_bash',
        toolName: 'Bash',
      },
      toolCallId: 'toolu_bash',
    });

    // The immediate tool_result carries the output path; the snapshot follows the result.
    const resultEvents = adapter.adapt(
      toolResult(
        'toolu_bash',
        `Command running in background with ID: bys1w0wxo. Output is being written to: ${OUTPUT}. You will be notified when it completes.`,
      ),
    );
    expect(resultEvents.map((e) => e.type)).toEqual(['tool_result', 'background_task', 'tool_end']);
    expect(snapshots(resultEvents)[0].task).toMatchObject({
      outputFile: OUTPUT,
      status: 'running',
    });

    const [ended] = snapshots(adapter.adapt(notification()));
    expect(ended.task).toMatchObject({
      endedAt: expect.any(Number),
      outputFile: OUTPUT,
      status: 'completed',
      summary: 'Run 60 pings to localhost in background',
    });
    // Nothing is left to interrupt.
    expect(snapshots(adapter.flush())).toEqual([]);
  });

  it('calls a task stopped once Claude Code reports it killed', () => {
    const adapter = new ClaudeCodeAdapter();
    startBackgroundBash(adapter);

    // CC patches the status as soon as the process ends; the notification
    // carrying the output may only come at its next turn boundary.
    const [patched] = snapshots(
      adapter.adapt({
        patch: { end_time: 1_794_866_273_908, status: 'killed' },
        subtype: 'task_updated',
        task_id: 'bys1w0wxo',
        type: 'system',
      }),
    );
    expect(patched.task).toMatchObject({ endedAt: 1_794_866_273_908, status: 'stopped' });
    // An ended task is not interrupted by the stream ending before its notification.
    expect(snapshots(adapter.flush())).toEqual([]);
  });

  it('keeps the stopped status and adds the output when the notification lands', () => {
    const adapter = new ClaudeCodeAdapter();
    startBackgroundBash(adapter);
    adapter.adapt({
      patch: { end_time: 1_794_866_273_908, status: 'killed' },
      subtype: 'task_updated',
      task_id: 'bys1w0wxo',
      type: 'system',
    });

    const [stopped] = snapshots(adapter.adapt(notification({ status: 'stopped' })));
    expect(stopped.task).toMatchObject({
      endedAt: 1_794_866_273_908,
      outputFile: OUTPUT,
      status: 'stopped',
    });
  });

  it('does not end a task on a non-terminal patch', () => {
    const adapter = new ClaudeCodeAdapter();
    startBackgroundBash(adapter);
    const [patched] = snapshots(
      adapter.adapt({
        patch: { status: 'paused' },
        subtype: 'task_updated',
        task_id: 'bys1w0wxo',
        type: 'system',
      }),
    );
    expect(patched.task.status).toBe('running');
  });

  it('keeps a failed task failed with its error', () => {
    const adapter = new ClaudeCodeAdapter();
    startBackgroundBash(adapter);
    adapter.adapt({
      patch: { error: 'exit code 2', status: 'failed' },
      subtype: 'task_updated',
      task_id: 'bys1w0wxo',
      type: 'system',
    });

    const [failed] = snapshots(adapter.adapt(notification({ status: 'failed' })));
    expect(failed.task).toMatchObject({ error: 'exit code 2', status: 'failed' });
  });

  it('marks a task still running at the end of the stream interrupted', () => {
    const adapter = new ClaudeCodeAdapter();
    startBackgroundBash(adapter);

    const [interrupted] = snapshots(adapter.flush());
    expect(interrupted.task).toMatchObject({ endedAt: expect.any(Number), status: 'interrupted' });
    expect(snapshots(adapter.flush())).toEqual([]);
  });

  it('reports a Monitor task under its own tool name', () => {
    const adapter = new ClaudeCodeAdapter();
    adapter.adapt(toolUse('toolu_mon', 'Monitor', { command: 'ping -c 5 127.0.0.1' }));

    const [started] = snapshots(
      adapter.adapt(taskStarted({ task_id: 'bn4d0bue1', tool_use_id: 'toolu_mon' })),
    );
    expect(started).toMatchObject({ task: { toolName: 'Monitor' }, toolCallId: 'toolu_mon' });
  });

  it('leaves out async subagents', () => {
    const adapter = new ClaudeCodeAdapter();
    adapter.adapt(
      toolUse('toolu_agent', 'Agent', {
        prompt: 'reply with the word ok',
        run_in_background: true,
        subagent_type: 'general-purpose',
      }),
    );

    const agentTask = taskStarted({
      subagent_type: 'general-purpose',
      task_id: 'aef2018f8c978dc18',
      task_type: 'local_agent',
      tool_use_id: 'toolu_agent',
    });
    expect(snapshots(adapter.adapt(agentTask))).toEqual([]);
    expect(
      snapshots(
        adapter.adapt(notification({ task_id: 'aef2018f8c978dc18', tool_use_id: 'toolu_agent' })),
      ),
    ).toEqual([]);
    expect(snapshots(adapter.flush())).toEqual([]);
  });

  it('reports a foreground tool only once it moves to the background', () => {
    const adapter = new ClaudeCodeAdapter();
    adapter.adapt(toolUse('toolu_fg', 'Bash', { command: 'ping -c 8 127.0.0.1' }));

    const fgTask = taskStarted({
      is_backgrounded: false,
      task_id: 'bvzvn3s1f',
      tool_use_id: 'toolu_fg',
    });
    expect(snapshots(adapter.adapt(fgTask))).toEqual([]);

    const [backgrounded] = snapshots(
      adapter.adapt({
        patch: { is_backgrounded: true },
        subtype: 'task_updated',
        task_id: 'bvzvn3s1f',
        type: 'system',
      }),
    );
    expect(backgrounded.task).toMatchObject({ status: 'running', taskId: 'bvzvn3s1f' });
  });

  it('ignores a foreground tool that ends in the foreground', () => {
    const adapter = new ClaudeCodeAdapter();
    adapter.adapt(toolUse('toolu_fg', 'Bash', { command: 'ping -c 8 127.0.0.1' }));
    adapter.adapt(
      taskStarted({ is_backgrounded: false, task_id: 'bvzvn3s1f', tool_use_id: 'toolu_fg' }),
    );

    const fgEnd = notification({ output_file: '', task_id: 'bvzvn3s1f', tool_use_id: 'toolu_fg' });
    expect(snapshots(adapter.adapt(fgEnd))).toEqual([]);
    expect(snapshots(adapter.flush())).toEqual([]);
  });

  it('ignores a resumed session reporting a previous run orphan', () => {
    const adapter = new ClaudeCodeAdapter();
    expect(snapshots(adapter.adapt(notification({ status: 'stopped' })))).toEqual([]);
  });

  it('ignores tasks started by a subagent inner tool', () => {
    const adapter = new ClaudeCodeAdapter();
    expect(snapshots(adapter.adapt(taskStarted({ tool_use_id: 'toolu_inner' })))).toEqual([]);
  });

  it('reports progress summaries', () => {
    const adapter = new ClaudeCodeAdapter();
    startBackgroundBash(adapter);

    const [progress] = snapshots(
      adapter.adapt({
        description: 'Pinging',
        last_tool_name: 'Bash',
        subtype: 'task_progress',
        summary: '20 packets received',
        task_id: 'bys1w0wxo',
        type: 'system',
        usage: { duration_ms: 20_000, tool_uses: 0, total_tokens: 0 },
      }),
    );
    expect(progress.task).toMatchObject({
      description: 'Pinging',
      lastToolName: 'Bash',
      summary: '20 packets received',
    });
  });

  it('reports through the SDK adapter too', () => {
    const adapter = new ClaudeCodeSdkAdapter();
    adapter.adapt(toolUse('toolu_bash', 'Bash', { command: 'ping -c 60 127.0.0.1' }));
    expect(snapshots(adapter.adapt(taskStarted()))).toHaveLength(1);
  });

  it('stays silent for other Claude-compatible CLIs', () => {
    const adapter = new CodeBuddyAdapter();
    adapter.adapt(toolUse('toolu_bash', 'Bash', { command: 'ping -c 60 127.0.0.1' }));
    expect(snapshots(adapter.adapt(taskStarted()))).toEqual([]);
    expect(snapshots(adapter.flush())).toEqual([]);
  });
});

import { execFileSync, spawn } from 'node:child_process';

import type { RemoteHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';

import { getTrpcClient } from '../api/client';
import { getTask, listTasks, removeTask, saveTask } from '../daemon/taskRegistry';
import { log } from '../utils/logger';

const DEFAULT_HERMES_PORT = 3456;

/** Resolve the absolute path to the `lh` binary to avoid PATH issues in child processes. */
function resolveLhPath(): string {
  try {
    return execFileSync('which', ['lh'], { encoding: 'utf8' }).trim();
  } catch {
    return 'lh';
  }
}

export interface RunHeteroTaskParams {
  agentId?: string;
  agentType: RemoteHeterogeneousAgentType;
  cwd?: string;
  operationId: string;
  prompt: string;
  taskId: string;
  topicId: string;
}

export interface CancelHeteroTaskParams {
  signal?: 'SIGINT' | 'SIGKILL' | 'SIGTERM';
  taskId: string;
}

export function getHermesPort(): number {
  const env = process.env.HERMES_GATEWAY_PORT;
  if (env) {
    const parsed = Number.parseInt(env, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return DEFAULT_HERMES_PORT;
}

async function isHermesGatewayRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function startHermesGateway(port: number): Promise<void> {
  const child = spawn('hermes', ['gateway', 'start'], {
    detached: true,
    env: { ...process.env },
    stdio: 'ignore',
  });
  child.unref();

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 500));
    if (await isHermesGatewayRunning(port)) return;
  }
  throw new Error(`Hermes gateway did not start within 10s on port ${port}`);
}

async function sendAutoNotify(
  topicId: string,
  taskId: string,
  text: string,
  agentId?: string,
): Promise<void> {
  try {
    const client = await getTrpcClient();
    await client.agentNotify.notify.mutate({
      agentId,
      content: text,
      role: 'assistant',
      topicId,
    });
  } catch (err) {
    log.error('Failed to send auto-notify:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Signal remote hetero task completion to the server so it can publish
 * `agent_runtime_end` to the gateway WS and close the frontend subscription.
 * Called on clean process exit (code=0, no signal) — error exits go through
 * `sendAutoNotify` which writes an error message AND triggers completion via
 * the `done` flag.
 */
async function sendDoneSignal(topicId: string, agentId?: string): Promise<void> {
  try {
    const client = await getTrpcClient();
    await client.agentNotify.notify.mutate({
      agentId,
      content: '',
      done: true,
      role: 'assistant',
      topicId,
    });
  } catch (err) {
    log.error('Failed to send done signal:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Build the notify protocol injected into the first message of a new hetero-agent session.
 * Tells the agent how to push updates back to the LobeHub user via `lh notify`.
 */
function buildNotifyProtocol(lhPath: string, topicId: string): string {
  return (
    `## Context: This task was dispatched by LobeHub\n\n` +
    `This conversation / task was sent to you by the **LobeHub platform** on behalf of a user. You are running as a background agent; the user is waiting for your response inside the LobeHub chat interface.\n\n` +
    `**When to call notify**: any time you have something meaningful to tell the user — a key finding, a decision you made, a result, a question, or your final answer. Think of it as speaking directly to the user in the chat window.\n\n` +
    `**What to hide**: internal work details such as tool call sequences, file reads, intermediate command output, retries, or low-level reasoning steps. The user cares about outcomes and insights, not your step-by-step mechanics.\n\n` +
    `## Sending messages back to the user\n\n` +
    `Use the \`${lhPath} notify\` command. All your updates appear as a **single message bubble** in the UI — create it once and update it in place.\n\n` +
    `**Step 1 — Open the bubble on your first meaningful update** (captures the messageId):\n` +
    `\`\`\`\n` +
    `MSG_ID=$(${lhPath} notify --topic ${topicId} --role assistant --content "Starting..." --json | grep -o '"messageId":"[^"]*"' | cut -d'"' -f4)\n` +
    `\`\`\`\n\n` +
    `**Step 2 — Update the same bubble as you make progress**:\n` +
    `\`\`\`\n` +
    `${lhPath} notify --topic ${topicId} --role assistant --message-id "$MSG_ID" --content "Still working..."\n` +
    `\`\`\`\n\n` +
    `**Step 3 — Replace with your complete, final response when done**:\n` +
    `\`\`\`\n` +
    `${lhPath} notify --topic ${topicId} --role assistant --message-id "$MSG_ID" --content "<your full response here>"\n` +
    `\`\`\`\n\n` +
    `Rules:\n` +
    `- Always use \`--json\` on the first call and capture \`messageId\` from the output.\n` +
    `- Always pass \`--message-id\` on every subsequent call so updates overwrite the same bubble.\n` +
    `- Write what matters to the user — not implementation steps or internal tool calls.\n` +
    `- Call notify at least once when the task is done, even if there were no intermediate updates.`
  );
}

export async function runHeteroTask(params: RunHeteroTaskParams): Promise<string> {
  const { agentId, agentType, cwd, operationId, prompt, taskId, topicId } = params;
  const workDir = cwd || process.cwd();
  const lhPath = resolveLhPath();

  if (agentType === 'openclaw') {
    // openclaw agent --local is one-shot: each invocation processes one message and exits.
    // The --session-id links turns into the same conversation history on disk.
    // Requires the `openclaw` binary to be on PATH with Node >=22.19.
    const openclawAgent = process.env.OPENCLAW_AGENT_ID ?? 'main';

    // Always inject the notify protocol so openclaw knows how to report results
    // back to the LobeHub UI — even if the previous turn failed and the session
    // history was not cleanly committed.
    const enrichedPrompt = `${prompt}\n\n${buildNotifyProtocol(lhPath, topicId)}`;

    // Kill any existing openclaw process for this topicId before spawning a new one.
    // openclaw serialises session writes; a concurrent process holding the session
    // lock will cause the new one to exit with code 1.
    for (const existing of listTasks()) {
      if (existing.topicId === topicId && existing.agentType === 'openclaw') {
        try {
          process.kill(existing.pid, 'SIGTERM');
        } catch {
          // Already exited — nothing to do.
        }
        removeTask(existing.taskId);
      }
    }

    const child = spawn(
      'openclaw',
      [
        'agent',
        '--agent',
        openclawAgent,
        '--session-id',
        topicId,
        '--message',
        enrichedPrompt,
        '--local',
      ],
      {
        cwd: workDir,
        detached: true,
        env: { ...process.env },
        stdio: 'ignore',
      },
    );

    const pid = child.pid;
    if (pid === undefined) {
      throw new Error('Failed to get PID for openclaw process');
    }
    child.unref();

    saveTask({
      agentId,
      agentType,
      operationId,
      pid,
      startedAt: new Date().toISOString(),
      taskId,
      topicId,
    });
    log.info(`OpenClaw task started: taskId=${taskId} pid=${pid} agent=${openclawAgent}`);

    // On exit: notify the server so it can close the frontend gateway WS subscription.
    // - Abnormal exit (signal or non-zero code): write an error message bubble.
    // - Clean exit (code=0, no signal): openclaw already sent its final message via
    //   `lh notify`; just send a done signal to publish `agent_runtime_end`.
    child.on('close', (code, signal) => {
      removeTask(taskId);
      if (code !== 0 || signal !== null) {
        const text = signal
          ? `Task cancelled (signal: ${signal})`
          : `Task failed (exit code: ${code})`;
        // Send error message first, THEN signal done (sequential).
        // Fire-and-forget both, but ensure done is always sent even if notify fails.
        void sendAutoNotify(topicId, taskId, text, agentId).finally(() =>
          sendDoneSignal(topicId, agentId),
        );
      } else {
        // Clean exit — openclaw already sent its final message; just signal done.
        void sendDoneSignal(topicId, agentId);
      }
    });

    return JSON.stringify({ pid, taskId });
  }

  if (agentType === 'hermes') {
    const port = getHermesPort();

    if (!(await isHermesGatewayRunning(port))) {
      log.info(`Hermes gateway not running on port ${port}, starting...`);
      await startHermesGateway(port);
    }

    const res = await fetch(`http://localhost:${port}/message`, {
      body: JSON.stringify({ content: prompt, operationId }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!res.ok) {
      throw new Error(`Hermes gateway returned ${res.status}: ${await res.text()}`);
    }

    // pid is 0 for Hermes — the gateway is long-lived and cancellation uses
    // the HTTP /stop API rather than direct signal delivery.
    saveTask({
      agentId,
      agentType,
      operationId,
      pid: 0,
      startedAt: new Date().toISOString(),
      taskId,
      topicId,
    });
    log.info(`Hermes task dispatched: taskId=${taskId} operationId=${operationId}`);

    return JSON.stringify({ operationId, taskId });
  }

  throw new Error(`Unsupported agentType: ${agentType as string}`);
}

export async function cancelHeteroTask(params: CancelHeteroTaskParams): Promise<string> {
  const { signal = 'SIGINT', taskId } = params;
  const entry = getTask(taskId);

  if (!entry) {
    return JSON.stringify({ message: `No task found with taskId: ${taskId}`, success: false });
  }

  if (entry.agentType === 'hermes') {
    const port = getHermesPort();
    try {
      await fetch(`http://localhost:${port}/stop`, {
        body: JSON.stringify({ operationId: entry.operationId }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
    } catch (err) {
      log.warn(
        `Failed to send /stop to Hermes gateway: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    removeTask(taskId);
    await sendAutoNotify(entry.topicId, taskId, 'Task cancelled', entry.agentId);
    return JSON.stringify({ taskId });
  }

  // OpenClaw: kill by PID and let the child's close handler send the notify.
  try {
    process.kill(entry.pid, signal);
  } catch (err) {
    // Process already exited — exit handler won't fire; clean up manually.
    log.warn(
      `Failed to send ${signal} to pid ${entry.pid}: ${err instanceof Error ? err.message : String(err)}`,
    );
    removeTask(taskId);
    await sendAutoNotify(
      entry.topicId,
      taskId,
      'Task already completed or cancelled',
      entry.agentId,
    );
  }

  return JSON.stringify({ pid: entry.pid, signal, taskId });
}

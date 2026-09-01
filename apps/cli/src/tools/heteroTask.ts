import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { RemoteHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import { resolveRemotePlatformRuntime } from '@lobechat/heterogeneous-agents/scanHost';

import { getTrpcClient } from '../api/client';
import { CLI_PRODUCT_NAME, resolveCliDirName } from '../constants/identity';
import { getTask, listTasks, removeTask, saveTask } from '../daemon/taskRegistry';
import { log } from '../utils/logger';

// ─── Hermes session persistence ───
// Maps topicId → hermes session_id so multi-turn conversations can resume
// the same session across separate `runHeteroTask` invocations.

const LOBEHUB_DIR_NAME = resolveCliDirName();
const HERMES_SESSIONS_FILE = path.join(os.homedir(), LOBEHUB_DIR_NAME, 'hermes-sessions.json');

function parseHermesSessionId(stderr: string): string | undefined {
  for (const line of stderr.split(/\r?\n/).reverse()) {
    const match = line.match(/^session_id:\s*(\S+)\s*$/);
    if (match) return match[1];
  }

  return undefined;
}

function getHermesSessionId(topicId: string): string | undefined {
  try {
    const data = JSON.parse(fs.readFileSync(HERMES_SESSIONS_FILE, 'utf8')) as Record<
      string,
      string
    >;
    return data[topicId];
  } catch {
    return undefined;
  }
}

function saveHermesSessionId(topicId: string, sessionId: string): void {
  let data: Record<string, string> = {};
  try {
    data = JSON.parse(fs.readFileSync(HERMES_SESSIONS_FILE, 'utf8')) as Record<string, string>;
  } catch {
    // File doesn't exist yet — start fresh.
  }
  data[topicId] = sessionId;
  fs.mkdirSync(path.dirname(HERMES_SESSIONS_FILE), { recursive: true });
  fs.writeFileSync(HERMES_SESSIONS_FILE, JSON.stringify(data), 'utf8');
}

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
  parentOperationId?: string;
  platformAgentId?: string;
  prompt: string;
  taskId: string;
  topicId: string;
  /**
   * Workspace id seeded by the server when the dispatched topic lives in a
   * workspace. Threaded into auto-notify calls (as `X-Workspace-Id`) and into
   * the spawned child's `LOBEHUB_WORKSPACE_ID` env so its own `lh notify`
   * shells inherit the same scope.
   */
  workspaceId?: string;
}

export interface CancelHeteroTaskParams {
  signal?: 'SIGINT' | 'SIGKILL' | 'SIGTERM';
  taskId: string;
}

async function sendAutoNotify(
  topicId: string,
  taskId: string,
  text: string,
  agentId?: string,
  operationId?: string,
  workspaceId?: string,
): Promise<void> {
  try {
    const client = await getTrpcClient(workspaceId);
    await client.agentNotify.notify.mutate({
      agentId,
      content: text,
      operationId,
      role: 'assistant',
      topicId,
    });
  } catch (err) {
    log.error('Failed to send auto-notify:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Signal remote hetero task termination to the server so it can publish
 * `agent_runtime_end`, close the frontend subscription, and fire the run's
 * lifecycle hooks (task lifecycle + IM bot callback).
 *
 * Pass `error` to finalize the run as FAILED (non-zero process exit), or
 * `cancelled` to finalize it as INTERRUPTED (signal exit). Omit both for a clean
 * completion (the agent already sent its final message via `lh notify`).
 */
async function sendTerminalSignal(
  topicId: string,
  agentId?: string,
  operationId?: string,
  workspaceId?: string,
  error?: { message: string; type?: string },
  cancelled = false,
): Promise<void> {
  try {
    const client = await getTrpcClient(workspaceId);
    await client.agentNotify.notify.mutate({
      agentId,
      content: '',
      done: true,
      operationId,
      ...(cancelled ? { cancelled: true } : {}),
      ...(error ? { error } : {}),
      role: 'assistant',
      topicId,
    });
  } catch (err) {
    log.error('Failed to send terminal signal:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Build the notify protocol injected into the first message of a new hetero-agent session.
 * Tells the agent how to push updates back to the LobeHub user via `lh notify`.
 */
function buildNotifyProtocol(lhPath: string, topicId: string): string {
  return (
    `## Context: This task was dispatched by ${CLI_PRODUCT_NAME}\n\n` +
    `This conversation / task was sent to you by the **${CLI_PRODUCT_NAME} platform** on behalf of a user. You are running as a background agent; the user is waiting for your response inside the ${CLI_PRODUCT_NAME} chat interface.\n\n` +
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
  const {
    agentId,
    agentType,
    cwd,
    operationId,
    parentOperationId,
    platformAgentId,
    prompt,
    taskId,
    topicId,
    workspaceId,
  } = params;
  const workDir = cwd || process.cwd();
  const lhPath = resolveLhPath();
  // Propagate workspace scope into the spawned child so its own `lh notify`
  // invocations (and any grandchildren it shells out) inherit the same scope
  // via getTrpcClient → resolveWorkspaceId.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    LOBEHUB_OPERATION_ID: operationId,
    ...(workspaceId && { LOBEHUB_WORKSPACE_ID: workspaceId }),
  };
  const sessionKey = parentOperationId ? operationId : topicId;

  if (agentType === 'openclaw') {
    const runtime = await resolveRemotePlatformRuntime('openclaw', childEnv);
    if (!runtime.available) {
      throw new Error('OpenClaw executable not found');
    }

    // openclaw agent --local is one-shot: each invocation processes one message and exits.
    // The --session-id links turns into the same conversation history on disk.
    const openclawAgent = platformAgentId?.trim() || process.env.OPENCLAW_AGENT_ID || 'main';

    // Always inject the notify protocol so openclaw knows how to report results
    // back to the LobeHub UI — even if the previous turn failed and the session
    // history was not cleanly committed.
    const enrichedPrompt = `${prompt}\n\n${buildNotifyProtocol(lhPath, topicId)}`;
    const openclawArgs = [
      'agent',
      '--agent',
      openclawAgent,
      '--session-id',
      sessionKey,
      '--message',
      enrichedPrompt,
      '--local',
    ];
    const spawnPlan = await runtime.prepareSpawn(openclawArgs);

    // Top-level turns reuse one topic session and replace an older process. Group
    // members intentionally share a topic, so isolate them by operation instead.
    // openclaw serialises session writes; a concurrent process holding the session
    // lock will cause the new one to exit with code 1.
    for (const existing of listTasks()) {
      if (
        existing.agentType === 'openclaw' &&
        (existing.taskId === taskId ||
          (!parentOperationId && !existing.parentOperationId && existing.topicId === topicId))
      ) {
        try {
          process.kill(existing.pid, 'SIGTERM');
        } catch {
          // Already exited — nothing to do.
        }
        removeTask(existing.taskId);
      }
    }

    const child = spawn(spawnPlan.command, spawnPlan.args, {
      cwd: workDir,
      detached: true,
      env: spawnPlan.env,
      stdio: 'ignore',
    });

    const pid = child.pid;
    if (pid === undefined) {
      throw new Error('Failed to get PID for openclaw process');
    }
    child.unref();

    saveTask({
      agentId,
      agentType,
      operationId,
      parentOperationId,
      pid,
      startedAt: new Date().toISOString(),
      taskId,
      topicId,
      workspaceId,
    });
    log.info(`OpenClaw task started: taskId=${taskId} pid=${pid} agent=${openclawAgent}`);

    // On exit: notify the server so it can close the frontend gateway WS subscription.
    // - Failed exit (non-zero code, no signal): write an error bubble AND finalize
    //   the run as failed so the owning task is marked failed.
    // - Cancelled (killed by signal, e.g. interruptTask): write a notice + a plain
    //   terminal signal — cancellation is not a failure.
    // - Clean exit (code=0, no signal): openclaw already sent its final message via
    //   `lh notify`; just send a terminal signal to publish `agent_runtime_end`.
    child.on('close', (code, signal) => {
      if (getTask(taskId)?.pid !== pid) return;
      removeTask(taskId);
      if (code !== 0 || signal !== null) {
        const cancelled = signal !== null;
        const text = cancelled
          ? `Task cancelled (signal: ${signal})`
          : `Task failed (exit code: ${code})`;
        // Write the notice bubble first, THEN signal terminal (sequential).
        // Fire-and-forget both, but ensure the terminal signal is always sent.
        void sendAutoNotify(topicId, taskId, text, agentId, operationId, workspaceId).finally(() =>
          sendTerminalSignal(
            topicId,
            agentId,
            operationId,
            workspaceId,
            cancelled ? undefined : { message: text, type: 'HeteroProcessError' },
            cancelled,
          ),
        );
      } else {
        // Clean exit — openclaw already sent its final message; just signal done.
        void sendTerminalSignal(topicId, agentId, operationId, workspaceId);
      }
    });

    return JSON.stringify({ pid, taskId });
  }

  if (agentType === 'hermes') {
    const runtime = await resolveRemotePlatformRuntime('hermes', childEnv);
    if (!runtime.available) {
      throw new Error('Hermes executable not found');
    }

    // Resume the previous session for this topic if one exists.
    const existingSessionId = getHermesSessionId(sessionKey);
    const hermesArgs: string[] = ['chat', '--query', prompt, '--quiet', '--accept-hooks'];
    if (existingSessionId) {
      hermesArgs.push('--resume', existingSessionId);
    }
    const spawnPlan = await runtime.prepareSpawn(hermesArgs);

    // Preserve parallel group members; only top-level turns replace the previous
    // topic process, while an exact task retry replaces itself.
    for (const existing of listTasks()) {
      if (
        existing.agentType === 'hermes' &&
        (existing.taskId === taskId ||
          (!parentOperationId && !existing.parentOperationId && existing.topicId === topicId))
      ) {
        try {
          process.kill(existing.pid, 'SIGTERM');
        } catch {
          // Already exited — nothing to do.
        }
        removeTask(existing.taskId);
      }
    }

    // Hermes keeps stdout response-only in --quiet mode and prints the final
    // session_id to stderr so callers can resume the session on the next turn.
    const child = spawn(spawnPlan.command, spawnPlan.args, {
      cwd: workDir,
      detached: true,
      env: spawnPlan.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const pid = child.pid;
    if (pid === undefined) throw new Error('Failed to get PID for hermes process');
    child.unref();

    saveTask({
      agentId,
      agentType,
      operationId,
      parentOperationId,
      pid,
      startedAt: new Date().toISOString(),
      taskId,
      topicId,
      workspaceId,
    });
    log.info(`Hermes task started: taskId=${taskId} pid=${pid}`);

    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code, signal) => {
      if (getTask(taskId)?.pid !== pid) return;
      removeTask(taskId);

      if (code !== 0 || signal !== null) {
        const cancelled = signal !== null;
        const text = cancelled
          ? `Task cancelled (signal: ${signal})`
          : `Task failed (exit code: ${code})`;
        void sendAutoNotify(topicId, taskId, text, agentId, operationId, workspaceId).finally(() =>
          sendTerminalSignal(
            topicId,
            agentId,
            operationId,
            workspaceId,
            cancelled ? undefined : { message: text, type: 'HeteroProcessError' },
            cancelled,
          ),
        );
        return;
      }

      // Diagnostics may precede the final ID, and context compaction can rotate
      // it, so persist the last complete session_id line emitted this turn.
      const sessionId = parseHermesSessionId(stderr);
      const response = stdout.trim();

      if (sessionId) saveHermesSessionId(sessionKey, sessionId);

      if (response) {
        void sendAutoNotify(topicId, taskId, response, agentId, operationId, workspaceId).finally(
          () => sendTerminalSignal(topicId, agentId, operationId, workspaceId),
        );
      } else {
        void sendTerminalSignal(topicId, agentId, operationId, workspaceId);
      }
    });

    return JSON.stringify({ pid, taskId });
  }

  throw new Error(`Unsupported agentType: ${agentType as string}`);
}

export async function cancelHeteroTask(params: CancelHeteroTaskParams): Promise<string> {
  const { signal = 'SIGINT', taskId } = params;
  const entry = getTask(taskId);

  if (!entry) {
    return JSON.stringify({ message: `No task found with taskId: ${taskId}`, success: false });
  }

  // Both openclaw and hermes: kill by PID and let the child's close handler send the notify.
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
      entry.operationId,
      entry.workspaceId,
    );
  }

  return JSON.stringify({ pid: entry.pid, signal, taskId });
}

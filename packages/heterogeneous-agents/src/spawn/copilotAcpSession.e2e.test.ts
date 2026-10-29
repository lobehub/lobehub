import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { describe, expect, it } from 'vitest';

import { AskUserBridge } from '../askUser/AskUserBridge';
import type { SpawnAgentOptions } from './spawnAgent';
import { spawnAgent } from './spawnAgent';

/**
 * End-to-end against a REAL `copilot --acp` — real tool execution and real
 * permission requests, across separate CLI processes the way LobeHub runs
 * every turn.
 *
 * Opt in with `COPILOT_ACP_E2E=1`. Copilot authenticates from the inherited
 * environment: a GitHub login, or BYOK (`COPILOT_PROVIDER_BASE_URL`, …).
 * Point `COPILOT_HOME` at a scratch directory to keep these sessions out of
 * your own history, `COPILOT_BIN` at a non-PATH install, and
 * `COPILOT_ACP_E2E_CWD` at the workspace to run in.
 */

const runnable = process.env.COPILOT_ACP_E2E === '1';

const PROMPT =
  'Read the file notes.txt in the current directory, then run the shell command `echo copilot-acp-e2e && uname -s`. Reply with the first line of notes.txt and the command output.';

const workspace = async () => {
  const cwd =
    process.env.COPILOT_ACP_E2E_CWD ?? (await mkdtemp(path.join(tmpdir(), 'copilot-e2e-')));
  await writeFile(path.join(cwd, 'notes.txt'), 'probe-line-1: copilot acp fixture\n');
  return cwd;
};

const run = async (
  options: Omit<SpawnAgentOptions, 'agentType' | 'operationId'>,
  onEvent?: (event: AgentStreamEvent, handle: Awaited<ReturnType<typeof spawnAgent>>) => void,
) => {
  const handle = await spawnAgent({
    ...(process.env.COPILOT_BIN ? { command: process.env.COPILOT_BIN } : {}),
    ...options,
    agentType: 'copilot',
    operationId: 'op-copilot-e2e',
  });
  const events: AgentStreamEvent[] = [];
  for await (const event of handle.events) {
    events.push(event);
    onEvent?.(event, handle);
  }
  return { events, exit: await handle.exit, sessionId: handle.sessionId };
};

/** Answer each permission prompt the bridge raises with `optionId`, or hand it to `onRaised`. */
const watchPermissions = (bridge: AskUserBridge, onRaised: (data: any) => void) => {
  const raised: any[] = [];
  void (async () => {
    for await (const event of bridge.events()) {
      if (event.type !== 'agent_intervention_request') continue;
      raised.push(event.data);
      onRaised(event.data);
    }
  })();
  return raised;
};

const toolIds = (events: AgentStreamEvent[], type: AgentStreamEvent['type']) =>
  events.filter((e) => e.type === type).map((e) => (e.data as any).toolCallId as string);

describe.runIf(runnable)('GitHub Copilot ACP — live CLI', () => {
  it('runs tools behind a LobeHub permission prompt, then resumes the session', async () => {
    const cwd = await workspace();
    const bridge = new AskUserBridge('op-copilot-e2e', {
      identifier: 'claude-code',
      provider: 'copilot',
    });
    const raised = watchPermissions(bridge, (data) => {
      const [{ question }] = JSON.parse(data.arguments).questions;
      bridge.resolve(data.toolCallId, { result: { [question]: 'allow_once' } });
    });

    const first = await run({ askUserBridge: bridge, cwd, prompt: PROMPT });

    expect(first.events.filter((e) => e.type === 'error')).toEqual([]);
    expect(raised.length).toBeGreaterThan(0);
    const started = toolIds(first.events, 'tool_start');
    expect(started.length).toBeGreaterThan(raised.length);
    // Every raw tool item keeps one id from start to result to end.
    expect(new Set(started).size).toBe(started.length);
    expect(toolIds(first.events, 'tool_result').toSorted()).toEqual(started.toSorted());
    expect(toolIds(first.events, 'tool_end').toSorted()).toEqual(started.toSorted());
    expect(first.events.at(-1)).toMatchObject({
      data: { stopReason: 'end_turn' },
      type: 'agent_runtime_end',
    });
    expect(first.sessionId).toBeTruthy();

    const second = await run({
      allowAll: true,
      cwd,
      initialModel: 'claude-haiku-4.5',
      prompt: 'What did I ask you to do before? Answer in one sentence.',
      resumeSessionId: first.sessionId,
    });

    expect(second.sessionId).toBe(first.sessionId);
    expect(second.events.filter((e) => e.type === 'error')).toEqual([]);
    // The loaded history is not replayed into the new turn.
    expect(toolIds(second.events, 'tool_start').filter((id) => started.includes(id))).toEqual([]);
    expect(second.events.find((e) => e.type === 'stream_start')?.data).toMatchObject({
      model: 'claude-haiku-4.5',
    });
    expect(second.events.at(-1)).toMatchObject({ type: 'agent_runtime_end' });
  }, 180_000);

  it('cancels a turn that is waiting on a permission prompt', async () => {
    const cwd = await workspace();
    const bridge = new AskUserBridge('op-copilot-e2e', {
      identifier: 'claude-code',
      provider: 'copilot',
    });
    let handle: Awaited<ReturnType<typeof spawnAgent>> | undefined;
    watchPermissions(bridge, () => handle?.kill('SIGINT'));

    const result = await run({ askUserBridge: bridge, cwd, prompt: PROMPT }, (_event, h) => {
      handle = h;
    });

    expect(result.exit).toEqual({ code: null, signal: 'SIGINT' });
    expect(result.events.at(-1)).toMatchObject({
      data: { reason: 'interrupted', stopReason: 'cancelled' },
      type: 'agent_runtime_end',
    });
    // The blocked tool gets a terminal result even though Copilot sends none.
    expect(
      result.events.filter(
        (e) =>
          e.type === 'tool_result' &&
          (e.data as any).content === 'Cancelled before the tool finished.',
      ),
    ).toHaveLength(1);
    expect(toolIds(result.events, 'tool_end').toSorted()).toEqual(
      toolIds(result.events, 'tool_start').toSorted(),
    );
  }, 180_000);
});

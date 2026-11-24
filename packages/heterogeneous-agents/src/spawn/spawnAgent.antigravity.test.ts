import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AntigravityAcpSessionModule from './antigravityAcpSession';
import { spawnAgent } from './spawnAgent';

const { sessions } = vi.hoisted(() => ({ sessions: [] as any[] }));

vi.mock('./antigravityAcpSession', async (importOriginal) => {
  const actual = await importOriginal<typeof AntigravityAcpSessionModule>();
  class FakeAntigravityAcpSession {
    nativeId: string | undefined;
    steer = vi.fn(() => true);
    constructor(readonly options: any) {
      sessions.push(this);
    }
    get sessionId() {
      return this.nativeId;
    }
    close() {}
    interrupt() {}
    async run() {
      this.nativeId = 'agy-session-1';
    }
  }
  return { ...actual, AntigravityAcpSession: FakeAntigravityAcpSession };
});

describe('spawnAgent — Antigravity', () => {
  beforeEach(() => {
    sessions.length = 0;
  });

  it('runs over ACP and steers follow-ups into the session', async () => {
    const handle = await spawnAgent({
      agentType: 'antigravity',
      command: 'agy',
      cwd: process.cwd(),
      env: { LOBEHUB_CONNECT_SERVICE: '1', SSH_CONNECTION: '1 2 3 4' },
      extraArgs: ['--model', 'gemini-4-neon-xhigh'],
      operationId: 'op-1',
      prompt: 'hello',
      resumeSessionId: 'agy-session-0',
    });

    const [session] = sessions;
    expect(session.options).toMatchObject({
      args: ['--model', 'gemini-4-neon-xhigh'],
      commandPath: 'agy',
      prompt: [{ text: 'hello', type: 'text' }],
      resumeSessionId: 'agy-session-0',
    });
    // A Connect service must not hand agy an inherited SSH session.
    expect(session.options.env.SSH_CONNECTION).toBeUndefined();
    expect(handle.supportsSteerImageAttachments).toBe(true);

    await expect(handle.sendUserMessage!('no id')).resolves.toBe(false);
    await expect(handle.sendUserMessage!('follow up', { uuid: 'msg-1' })).resolves.toBe(true);
    expect(session.steer).toHaveBeenCalledWith([{ text: 'follow up', type: 'text' }], 'msg-1');

    await handle.exit;
    // Read lazily: agy names the session only once it is set up.
    expect(handle.sessionId).toBe('agy-session-1');
  });
});

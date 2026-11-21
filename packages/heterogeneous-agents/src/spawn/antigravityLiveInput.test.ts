import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { AntigravityLiveInput, resolveAntigravityLiveRuntimeEnd } from './antigravityLiveInput';

describe('AntigravityLiveInput', () => {
  it('closes stdin after a single successful turn when no steered messages are pending', () => {
    const stdin = new PassThrough();
    const writes: string[] = [];
    stdin.on('data', (chunk) => writes.push(chunk.toString()));

    const live = new AntigravityLiveInput(stdin);
    expect(live.send('{"event":"user","message":{"content":"first"}}\n')).toBe(true);
    expect(live.isOpen).toBe(true);

    live.observe('{"event":"init","conversation_id":"c1"}\n');
    live.observe(
      '{"event":"step_update","step_update":{"step_index":0,"state":"DONE","step_type":"user_input"}}\n',
    );
    live.observe('{"event":"result","result":{"status":"SUCCESS","num_turns":1}}\n');

    expect(live.isOpen).toBe(false);
    expect(live.lastTurn).toEqual({ ok: true, status: 'SUCCESS' });
    expect(live.send('{"event":"user","message":{"content":"late"}}\n', 'u-late')).toBe(false);
    expect(writes).toHaveLength(1);
  });

  it('keeps stdin open across turn boundaries while a steered message is pending, then closes when idle', () => {
    const stdin = new PassThrough();
    const writes: string[] = [];
    stdin.on('data', (chunk) => writes.push(chunk.toString()));

    const live = new AntigravityLiveInput(stdin);
    expect(live.send('{"event":"user","message":{"content":"first"}}\n')).toBe(true);
    live.observe('{"event":"init","conversation_id":"c1"}\n');
    live.observe(
      '{"event":"step_update","step_update":{"step_index":0,"state":"DONE","step_type":"user_input"}}\n',
    );

    // Steer arrives while turn 1 is still running
    expect(live.send('{"event":"user","message":{"content":"steer"}}\n', 'u-steer')).toBe(true);
    live.observe('{"event":"result","result":{"status":"SUCCESS","num_turns":1}}\n');

    // Stdin stays open because u-steer has not been picked up yet
    expect(live.isOpen).toBe(true);
    expect(live.takeSteerUuid()).toBe('u-steer');
    expect(live.takeSteerUuid()).toBeUndefined();

    // Turn 2 picks up u-steer and completes
    live.observe(
      '{"event":"step_update","step_update":{"step_index":4,"state":"DONE","step_type":"user_input"}}\n',
    );
    expect(live.isOpen).toBe(true);
    live.observe('{"event":"result","result":{"status":"SUCCESS","num_turns":2}}\n');

    expect(live.isOpen).toBe(false);
    expect(live.lastTurn).toEqual({ ok: true, status: 'SUCCESS' });
    expect(writes).toHaveLength(2);
  });

  it('closes immediately on a failed turn even when a steered message is queued', () => {
    const stdin = new PassThrough();
    const live = new AntigravityLiveInput(stdin);
    live.send('{"event":"user","message":{"content":"first"}}\n');
    live.send('{"event":"user","message":{"content":"steer"}}\n', 'u-steer');
    live.observe('{"event":"result","result":{"status":"ERROR","error":"boom"}}\n');

    expect(live.isOpen).toBe(false);
    expect(live.lastTurn).toEqual({ ok: false, status: 'ERROR' });
  });

  it('ignores child-conversation user_input updates when tracking pending steers', () => {
    const stdin = new PassThrough();
    const live = new AntigravityLiveInput(stdin);
    live.send('{"event":"user","message":{"content":"first"}}\n');
    live.observe('{"event":"init","conversation_id":"parent-conv"}\n');
    live.observe(
      '{"event":"step_update","step_update":{"conversation_id":"parent-conv","step_index":0,"state":"DONE","step_type":"user_input"}}\n',
    );

    // Queue a steer for the parent conversation
    expect(live.send('{"event":"user","message":{"content":"steer"}}\n', 'u-steer')).toBe(true);
    // Child subagent conversation emits its own user_input — must NOT consume parent's pending steer
    live.observe(
      '{"event":"step_update","step_update":{"conversation_id":"child-conv","step_index":1,"state":"DONE","step_type":"user_input"}}\n',
    );
    // Parent turn 1 completes: stdin must stay open because u-steer is still pending
    live.observe(
      '{"event":"result","result":{"conversation_id":"parent-conv","status":"SUCCESS"}}\n',
    );

    expect(live.isOpen).toBe(true);
    expect(live.takeSteerUuid()).toBe('u-steer');
  });
});

describe('resolveAntigravityLiveRuntimeEnd', () => {
  const cleanExit = { code: 0, killedByHost: false, sawError: false, signal: null };

  it('returns complete only on a clean exit after a successful turn', () => {
    expect(resolveAntigravityLiveRuntimeEnd({ ok: true, status: 'SUCCESS' }, cleanExit)).toEqual({
      reason: 'complete',
      transport: 'cli-live',
    });
    expect(
      resolveAntigravityLiveRuntimeEnd({ ok: false, status: 'ERROR' }, cleanExit),
    ).toBeUndefined();
    expect(resolveAntigravityLiveRuntimeEnd(undefined, cleanExit)).toBeUndefined();
    expect(
      resolveAntigravityLiveRuntimeEnd({ ok: true }, { ...cleanExit, code: 1 }),
    ).toBeUndefined();
    expect(
      resolveAntigravityLiveRuntimeEnd({ ok: true }, { ...cleanExit, killedByHost: true }),
    ).toBeUndefined();
    expect(
      resolveAntigravityLiveRuntimeEnd({ ok: true }, { ...cleanExit, sawError: true }),
    ).toBeUndefined();
  });
});

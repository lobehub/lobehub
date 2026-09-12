import { describe, expect, it } from 'vitest';

import { createDevicePoolPolicy, evaluateDevicePoolUse } from './devicePoolPolicy';

/** @example A permission is resolved from a complete, ordered pool path. */
describe('evaluateDevicePoolUse', () => {
  /** @example New pools allow the device owner in Chat and Task, but deny Bot and other people. */
  it('preserves conservative defaults for every trigger and subject', () => {
    const policy = createDevicePoolPolicy();
    for (const trigger of ['chat', 'task', 'bot'] as const) {
      /** @example The device owner has no implicit Bot exception. */
      expect(
        evaluateDevicePoolUse({
          policy,
          isDeviceOwner: true,
          subjects: ['workspaceMember', 'everyone'],
          trigger,
        }).allowed,
      ).toBe(trigger !== 'bot');
      /** @example A workspace member does not inherit the device owner identity. */
      expect(
        evaluateDevicePoolUse({ policy, subjects: ['workspaceMember', 'everyone'], trigger })
          .allowed,
      ).toBe(false);
    }
  });

  /** @example An Agent grants Bot to Everyone despite the pool's system Bot deny. */
  it('applies Agent overrides before pool defaults', () => {
    /** @example Explicit Bot allow wins over a default rule. */
    expect(
      evaluateDevicePoolUse({
        policy: createDevicePoolPolicy(),
        override: { bot: { everyone: 'allow' } },
        subjects: ['everyone'],
        trigger: 'bot',
      }),
    ).toEqual({ allowed: true, source: 'agent-override', subject: 'everyone' });
  });

  /** @example The pool's Bot restriction cannot be overridden by an Agent. */
  it('enforces hard restrictions before any subject or override', () => {
    /** @example Even a device owner-specific override cannot remove a pool restriction. */
    expect(
      evaluateDevicePoolUse({
        policy: { ...createDevicePoolPolicy(), blockedTriggers: ['bot'] },
        override: { bot: { everyone: 'allow' } },
        isDeviceOwner: true,
        subjects: ['everyone'],
        trigger: 'bot',
      }),
    ).toEqual({ allowed: false, source: 'hard-limit' });
  });

  /** @example Workspace member denies before Everyone allows. */
  it('resolves subject specificity and inheritance within a layer', () => {
    /** @example The first explicit applicable subject is decisive. */
    expect(
      evaluateDevicePoolUse({
        policy: createDevicePoolPolicy(),
        override: { chat: { workspaceMember: 'deny', everyone: 'allow' } },
        isDeviceOwner: true,
        subjects: ['workspaceMember', 'everyone'],
        trigger: 'chat',
      }),
    ).toEqual({ allowed: false, source: 'agent-override', subject: 'workspaceMember' });
  });

  /** @example An all-inherit Agent override follows the pool device owner Chat grant. */
  it('restores defaults for a fully inherited override', () => {
    /** @example Inherit skips the cell instead of denying. */
    expect(
      evaluateDevicePoolUse({
        policy: createDevicePoolPolicy(),
        override: { chat: { everyone: 'inherit' } },
        isDeviceOwner: true,
        subjects: ['everyone'],
        trigger: 'chat',
      }),
    ).toEqual({ allowed: true, source: 'system-default' });
  });

  /** @example Missing rules and an inherited fallback deny instead of granting. */
  it('fails closed when every layer inherits', () => {
    /** @example No rule supplies an authorization path. */
    expect(
      evaluateDevicePoolUse({
        policy: { blockedTriggers: [], everyone: 'inherit', rules: {} },
        subjects: ['everyone'],
        trigger: 'task',
      }),
    ).toEqual({ allowed: false, source: 'system-default' });
  });
});

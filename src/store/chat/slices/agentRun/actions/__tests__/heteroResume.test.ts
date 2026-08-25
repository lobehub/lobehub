import type { ChatTopicMetadata } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveHeteroResume } from '../transports/hetero/heteroResume';

describe('resolveHeteroResume', () => {
  const nativeKey = 'native:v1:claude-code';
  const resolveNative = (metadata: ChatTopicMetadata | undefined, cwd: string | undefined) =>
    resolveHeteroResume(metadata, cwd, { currentBindingKey: nativeKey });

  it('resumes from the session scoped to the current cwd', () => {
    const metadata: ChatTopicMetadata = {
      heteroSessionBindingKeyByWorkingDirectory: {
        '/Users/me/projA': nativeKey,
        '/Users/me/projB': nativeKey,
      },
      heteroSessionId: 'session-latest-other-cwd',
      heteroSessionIdByWorkingDirectory: {
        '/Users/me/projA': 'session-proj-a',
        '/Users/me/projB': 'session-proj-b',
      },
      workingDirectory: '/Users/me/projB',
    };

    expect(resolveNative(metadata, '/Users/me/projA')).toEqual({
      cwdChanged: false,
      resumeBindingKey: nativeKey,
      resumeSessionId: 'session-proj-a',
    });
  });

  it('resumes when saved cwd matches current cwd', () => {
    const metadata: ChatTopicMetadata = {
      heteroSessionBindingKey: nativeKey,
      heteroSessionId: 'session-123',
      workingDirectory: '/Users/me/projA',
    };

    expect(resolveNative(metadata, '/Users/me/projA')).toEqual({
      cwdChanged: false,
      resumeBindingKey: nativeKey,
      resumeSessionId: 'session-123',
    });
  });

  it('skips resume when saved cwd differs from current cwd', () => {
    const metadata: ChatTopicMetadata = {
      heteroSessionId: 'session-123',
      workingDirectory: '/Users/me/projA',
    };

    expect(resolveNative(metadata, '/Users/me/projB')).toEqual({
      cwdChanged: true,
      reason: 'cwd_changed',
      resumeSessionId: undefined,
    });
  });

  it('treats undefined current cwd as empty string (matches saved empty cwd)', () => {
    const metadata: ChatTopicMetadata = {
      heteroSessionBindingKey: nativeKey,
      heteroSessionId: 'session-123',
      workingDirectory: '',
    };

    expect(resolveNative(metadata, undefined)).toEqual({
      cwdChanged: false,
      resumeBindingKey: nativeKey,
      resumeSessionId: 'session-123',
    });
  });

  it('flags mismatch when saved cwd is non-empty but current cwd is undefined', () => {
    const metadata: ChatTopicMetadata = {
      heteroSessionId: 'session-123',
      workingDirectory: '/Users/me/projA',
    };

    expect(resolveNative(metadata, undefined)).toEqual({
      cwdChanged: true,
      reason: 'cwd_changed',
      resumeSessionId: undefined,
    });
  });

  it('resets legacy sessions that have no saved cwd', () => {
    // Legacy topics created before workingDirectory was persisted are unverifiable.
    // Passing the stale id through was the original bug — reset instead, and
    // let the next turn rebuild the session with a recorded cwd.
    const metadata: ChatTopicMetadata = {
      heteroSessionId: 'legacy-session',
    };

    expect(resolveNative(metadata, '/Users/me/any')).toEqual({
      cwdChanged: true,
      reason: 'missing_bound_cwd',
      resumeSessionId: undefined,
    });
  });

  it('returns no session when nothing is stored', () => {
    expect(resolveNative({}, '/Users/me/projA')).toEqual({
      cwdChanged: false,
      resumeSessionId: undefined,
    });
  });

  it('handles undefined metadata', () => {
    expect(resolveNative(undefined, '/Users/me/projA')).toEqual({
      cwdChanged: false,
      resumeSessionId: undefined,
    });
  });

  it('does not flag cwd change when there is no saved sessionId', () => {
    // cwd field lingering without a sessionId shouldn't trigger the toast;
    // there's nothing to skip resuming.
    const metadata: ChatTopicMetadata = {
      workingDirectory: '/Users/me/projA',
    };

    expect(resolveNative(metadata, '/Users/me/projB')).toEqual({
      cwdChanged: false,
      resumeSessionId: undefined,
    });
  });

  it('rejects a native session when its saved binding identity changed', () => {
    const metadata: ChatTopicMetadata = {
      heteroSessionBindingKey: 'native:v1:codex',
      heteroSessionId: 'session-123',
      workingDirectory: '/repo',
    };

    expect(resolveNative(metadata, '/repo')).toEqual({
      cwdChanged: false,
      reason: 'binding_changed',
      resumeSessionId: undefined,
    });
  });

  it('preserves a legacy native session without a binding key', () => {
    const metadata: ChatTopicMetadata = {
      heteroSessionId: 'legacy-native-session',
      workingDirectory: '/repo',
    };

    expect(resolveNative(metadata, '/repo')).toEqual({
      cwdChanged: false,
      resumeSessionId: 'legacy-native-session',
    });
  });

  it('rejects an explicit provider-bound session under native subscription auth', () => {
    const metadata: ChatTopicMetadata = {
      heteroSessionBindingKey: 'provider-binding:v1:old',
      heteroSessionId: 'provider-session',
      workingDirectory: '/repo',
    };

    expect(resolveNative(metadata, '/repo')).toEqual({
      cwdChanged: false,
      reason: 'binding_changed',
      resumeSessionId: undefined,
    });
  });

  it('passes the saved binding key to Desktop main for authoritative provider resolution', () => {
    const metadata: ChatTopicMetadata = {
      heteroSessionBindingKey: 'provider-binding:v1:old',
      heteroSessionId: 'session-123',
      workingDirectory: '/repo',
    };

    expect(resolveHeteroResume(metadata, '/repo', { providerBinding: true })).toEqual({
      cwdChanged: false,
      resumeBindingKey: 'provider-binding:v1:old',
      resumeSessionId: 'session-123',
    });
  });

  it('lets Desktop main reject a legacy session without a provider binding key', () => {
    const metadata: ChatTopicMetadata = {
      heteroSessionId: 'legacy-session',
      workingDirectory: '/repo',
    };

    expect(resolveHeteroResume(metadata, '/repo', { providerBinding: true })).toEqual({
      cwdChanged: false,
      resumeBindingKey: undefined,
      resumeSessionId: 'legacy-session',
    });
  });
});

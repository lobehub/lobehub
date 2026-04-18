import type { ChatTopicMetadata } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveHeteroResume } from '../heteroResume';

describe('resolveHeteroResume', () => {
  it('resumes when saved cwd matches current cwd', () => {
    const metadata: ChatTopicMetadata = {
      heteroSessionId: 'session-123',
      workingDirectory: '/Users/me/projA',
    };

    expect(resolveHeteroResume(metadata, '/Users/me/projA')).toEqual({
      cwdChanged: false,
      resumeSessionId: 'session-123',
    });
  });

  it('skips resume when saved cwd differs from current cwd', () => {
    const metadata: ChatTopicMetadata = {
      heteroSessionId: 'session-123',
      workingDirectory: '/Users/me/projA',
    };

    expect(resolveHeteroResume(metadata, '/Users/me/projB')).toEqual({
      cwdChanged: true,
      resumeSessionId: undefined,
    });
  });

  it('treats undefined current cwd as empty string (matches saved empty cwd)', () => {
    const metadata: ChatTopicMetadata = {
      heteroSessionId: 'session-123',
      workingDirectory: '',
    };

    expect(resolveHeteroResume(metadata, undefined)).toEqual({
      cwdChanged: false,
      resumeSessionId: 'session-123',
    });
  });

  it('flags mismatch when saved cwd is non-empty but current cwd is undefined', () => {
    const metadata: ChatTopicMetadata = {
      heteroSessionId: 'session-123',
      workingDirectory: '/Users/me/projA',
    };

    expect(resolveHeteroResume(metadata, undefined)).toEqual({
      cwdChanged: true,
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

    expect(resolveHeteroResume(metadata, '/Users/me/any')).toEqual({
      cwdChanged: true,
      resumeSessionId: undefined,
    });
  });

  it('returns no session when nothing is stored', () => {
    expect(resolveHeteroResume({}, '/Users/me/projA')).toEqual({
      cwdChanged: false,
      resumeSessionId: undefined,
    });
  });

  it('handles undefined metadata', () => {
    expect(resolveHeteroResume(undefined, '/Users/me/projA')).toEqual({
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

    expect(resolveHeteroResume(metadata, '/Users/me/projB')).toEqual({
      cwdChanged: false,
      resumeSessionId: undefined,
    });
  });
});

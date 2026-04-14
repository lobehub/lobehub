import { describe, expect, it } from 'vitest';

import {
  createConversationParentMissingError,
  isParentMessageMissingError,
  isPersistFatal,
  markPersistFatal,
} from '../messagePersistErrors';

describe('isParentMessageMissingError', () => {
  it('matches the drizzle + postgres-js error shape (FK via .cause)', () => {
    const error: any = new Error('Failed query: insert into messages ...');
    error.cause = { code: '23503', constraint: 'messages_parent_id_messages_id_fk' };
    expect(isParentMessageMissingError(error)).toBe(true);
  });

  it('matches top-level code/constraint_name variants', () => {
    const error: any = new Error('x');
    error.code = '23503';
    error.constraint_name = 'messages_parent_id_messages_id_fk';
    expect(isParentMessageMissingError(error)).toBe(true);
  });

  it('does not match other FK violations (different constraint)', () => {
    const error: any = new Error('x');
    error.cause = { code: '23503', constraint: 'messages_topic_id_topics_id_fk' };
    expect(isParentMessageMissingError(error)).toBe(false);
  });

  it('does not match non-FK pg errors', () => {
    const error: any = new Error('x');
    error.cause = { code: '23505', constraint: 'messages_parent_id_messages_id_fk' };
    expect(isParentMessageMissingError(error)).toBe(false);
  });

  it('handles null / non-object safely', () => {
    expect(isParentMessageMissingError(null)).toBe(false);
    expect(isParentMessageMissingError(undefined)).toBe(false);
    expect(isParentMessageMissingError('string-error')).toBe(false);
    expect(isParentMessageMissingError(42)).toBe(false);
  });
});

describe('createConversationParentMissingError', () => {
  it('carries errorType and parentId so downstream handlers can identify it', () => {
    const err: any = createConversationParentMissingError('msg_abc');
    expect(err).toBeInstanceOf(Error);
    expect(err.errorType).toBe('ConversationParentMissing');
    expect(err.parentId).toBe('msg_abc');
    expect(err.message).toContain('msg_abc');
  });

  it('keeps the original FK error as cause for diagnostics', () => {
    const cause = { code: '23503' };
    const err: any = createConversationParentMissingError('msg_abc', cause);
    expect(err.cause).toBe(cause);
  });
});

describe('persist-fatal marker', () => {
  it('round-trips through mark / is helpers', () => {
    const err = new Error('boom');
    expect(isPersistFatal(err)).toBe(false);
    markPersistFatal(err);
    expect(isPersistFatal(err)).toBe(true);
  });

  it('returns false for non-object values', () => {
    expect(isPersistFatal(null)).toBe(false);
    expect(isPersistFatal('boom')).toBe(false);
    expect(isPersistFatal(undefined)).toBe(false);
  });
});

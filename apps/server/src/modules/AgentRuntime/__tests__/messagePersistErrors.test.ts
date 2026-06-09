import { describe, expect, it } from 'vitest';

import {
  createConversationParentMissingError,
  isMidOperationReferenceMissingError,
  isPersistFatal,
  markPersistFatal,
} from '../messagePersistErrors';

describe('isMidOperationReferenceMissingError', () => {
  it('matches the drizzle + postgres-js error shape (FK via .cause)', () => {
    const error: any = new Error('Failed query: insert into messages ...');
    error.cause = { code: '23503', constraint: 'messages_parent_id_messages_id_fk' };
    expect(isMidOperationReferenceMissingError(error)).toBe(true);
  });

  it('matches top-level code/constraint_name variants', () => {
    const error: any = new Error('x');
    error.code = '23503';
    error.constraint_name = 'messages_parent_id_messages_id_fk';
    expect(isMidOperationReferenceMissingError(error)).toBe(true);
  });

  it.each([
    'messages_parent_id_messages_id_fk',
    'messages_quota_id_messages_id_fk',
    'messages_topic_id_topics_id_fk',
    'messages_agent_id_agents_id_fk',
    'messages_session_id_sessions_id_fk',
    'messages_thread_id_threads_id_fk',
  ])('matches every mid-operation-deletable reference FK: %s', (constraint) => {
    const error: any = new Error('x');
    error.cause = { code: '23503', constraint };
    expect(isMidOperationReferenceMissingError(error)).toBe(true);
  });

  it('does not match FK violations on out-of-scope constraints', () => {
    // user-account deletion / non-messages tables stay real failures
    const userFk: any = new Error('x');
    userFk.cause = { code: '23503', constraint: 'messages_user_id_users_id_fk' };
    expect(isMidOperationReferenceMissingError(userFk)).toBe(false);

    const otherTable: any = new Error('x');
    otherTable.cause = { code: '23503', constraint: 'files_user_id_users_id_fk' };
    expect(isMidOperationReferenceMissingError(otherTable)).toBe(false);
  });

  it('does not match non-FK pg errors', () => {
    const error: any = new Error('x');
    error.cause = { code: '23505', constraint: 'messages_parent_id_messages_id_fk' };
    expect(isMidOperationReferenceMissingError(error)).toBe(false);
  });

  it('handles null / non-object / missing-constraint safely', () => {
    expect(isMidOperationReferenceMissingError(null)).toBe(false);
    expect(isMidOperationReferenceMissingError(undefined)).toBe(false);
    expect(isMidOperationReferenceMissingError('string-error')).toBe(false);
    expect(isMidOperationReferenceMissingError(42)).toBe(false);
    expect(isMidOperationReferenceMissingError({ code: '23503' })).toBe(false);
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

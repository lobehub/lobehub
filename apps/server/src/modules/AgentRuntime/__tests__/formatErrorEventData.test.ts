import { describe, expect, it } from 'vitest';

import { formatErrorEventData } from '../formatErrorEventData';

describe('formatErrorEventData', () => {
  describe('PG enrichment', () => {
    it('classifies a top-level PostgresError (has .name set by driver, still unwrapped)', () => {
      // postgres-js style: error IS the PG error at the top level, with a
      // driver-assigned .name like "PostgresError". Prior to the fix this was
      // skipped because the condition required errorType to be missing or
      // exactly "Error" — losing the pg_<code> bucket on the dashboard.
      class PostgresError extends Error {
        code = '22021';
        column = 'state';
        detail = 'invalid byte sequence in column "state"';
        override name = 'PostgresError';
        severity = 'ERROR';
        table = 'message_plugins';
      }
      const err = new PostgresError('invalid byte sequence for encoding "UTF8": 0xed 0xa0 0x9f');

      const out = formatErrorEventData(err, 'tool_message_persist');

      expect(out.errorType).toBe('pg_22021');
      expect(out.error).toBe(
        'PG 22021 · ERROR · invalid byte sequence for encoding "UTF8": 0xed 0xa0 0x9f · detail=invalid byte sequence in column "state" · table=message_plugins · column=state',
      );
      expect(out.phase).toBe('tool_message_persist');
    });

    it('classifies a top-level pg DatabaseError (plain object shape)', () => {
      // node-postgres throws errors whose .name is "DatabaseError". The
      // diagnostic fields live directly on the instance.
      const err = Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
        constraint: 'messages_pkey',
        name: 'DatabaseError',
        severity: 'ERROR',
        table: 'messages',
      });

      const out = formatErrorEventData(err, 'persist');

      expect(out.errorType).toBe('pg_23505');
      expect(out.error).toContain('PG 23505');
      expect(out.error).toContain('constraint=messages_pkey');
    });

    it('unwraps PG info from .cause (drizzle + postgres-js wrapper)', () => {
      const err = new Error('Failed query: insert into "message_plugins" ...');
      (err as any).cause = {
        code: '54000',
        message: 'row is too big: size X, maximum size Y',
        severity: 'ERROR',
      };

      const out = formatErrorEventData(err, 'persist');

      expect(out.errorType).toBe('pg_54000');
      expect(out.error).toBe('PG 54000 · ERROR · row is too big: size X, maximum size Y');
    });
  });

  describe('business-typed errors (must not be overridden)', () => {
    it('preserves ConversationParentMissing errorType and message even when .cause has PG info', () => {
      // Mirrors createConversationParentMissingError from messagePersistErrors.ts:
      // the user-facing errorType lives on the error object directly, and the
      // original driver error is kept under .cause for diagnostics.
      const err = Object.assign(
        new Error('Conversation parent message msg_abc no longer exists.'),
        {
          cause: {
            code: '23503',
            constraint_name: 'messages_parent_id_messages_id_fk',
            message: 'FK violation',
            severity: 'ERROR',
          },
          errorType: 'ConversationParentMissing',
          parentId: 'msg_abc',
        },
      );

      const out = formatErrorEventData(err, 'persist');

      expect(out.errorType).toBe('ConversationParentMissing');
      expect(out.error).toBe('Conversation parent message msg_abc no longer exists.');
    });

    it('preserves a custom errorType even when no .cause PG info exists', () => {
      const err = Object.assign(new Error('rate limited'), {
        errorType: 'ProviderRateLimited',
      });
      const out = formatErrorEventData(err, 'call_llm');
      expect(out.errorType).toBe('ProviderRateLimited');
      expect(out.error).toBe('rate limited');
    });
  });

  describe('non-PG fallbacks (unchanged behavior)', () => {
    it('uses error.name when there is no PG info anywhere', () => {
      const err = new Error('fetch failed');
      (err as any).name = 'TypeError';
      const out = formatErrorEventData(err, 'call_llm');
      expect(out.errorType).toBe('TypeError');
      expect(out.error).toBe('fetch failed');
    });

    it('does not misclassify Node errors with a code but no PG severity', () => {
      // ENOTFOUND has a .code string, but no .severity — must not get pg_<code>.
      const err = Object.assign(new Error('getaddrinfo ENOTFOUND db.example'), {
        code: 'ENOTFOUND',
      });
      const out = formatErrorEventData(err, 'call_llm');
      expect(out.errorType).not.toMatch(/^pg_/);
      expect(out.error).toBe('getaddrinfo ENOTFOUND db.example');
    });

    it('returns Unknown error for null / non-object / non-string inputs', () => {
      expect(formatErrorEventData(null, 'p')).toEqual({
        error: 'Unknown error',
        errorType: undefined,
        phase: 'p',
      });
      expect(formatErrorEventData(undefined, 'p')).toEqual({
        error: 'Unknown error',
        errorType: undefined,
        phase: 'p',
      });
      expect(formatErrorEventData(42, 'p')).toEqual({
        error: 'Unknown error',
        errorType: undefined,
        phase: 'p',
      });
    });

    it('uses a plain string error directly', () => {
      const out = formatErrorEventData('boom', 'p');
      expect(out.error).toBe('boom');
      expect(out.errorType).toBeUndefined();
    });

    it('extracts from a plain payload object with only a message field', () => {
      const out = formatErrorEventData({ message: 'custom failure' }, 'p');
      expect(out.error).toBe('custom failure');
      expect(out.errorType).toBeUndefined();
    });
  });
});

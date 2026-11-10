import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { trpc } from '../lambda/init';
import {
  createDatabaseErrorRef,
  databaseError,
  isDrizzleQueryError,
  toDatabaseTRPCError,
} from './databaseError';

/**
 * The driver error both `postgres` and the Neon serverless driver throw.
 */
const postgresError = (props: Record<string, unknown>) =>
  Object.assign(new Error(String(props.message ?? 'database error')), props);

/**
 * A realistic Drizzle wrapper; `message` and the fixture body mirror what
 * production actually serialises onto the wire.
 */
const drizzleQueryError = (cause?: unknown) =>
  Object.assign(
    new Error(
      'Failed query: insert into "messages" ("id", "role", "content") values ($1, $2, $3)\nparams: msg_1,user,a user message',
    ),
    {
      cause,
      name: 'DrizzleQueryError',
      params: 'msg_1,user,a user message',
      query: 'insert into "messages" ("id", "role", "content") values ($1, $2, $3)',
    },
  );

/** Every message in the cause chain — what the server log prints via `cause`. */
const collectChainMessages = (error: unknown): string[] => {
  const messages: string[] = [];
  let current: unknown = error;

  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }

  return messages;
};

const selectLog = (overrides: Record<string, unknown> = {}) => ({
  code: '23503',
  column: 'workspace_id',
  constraint: 'messages_workspace_id_workspaces_id_fk',
  message: 'insert or update on table "messages" violates foreign key constraint',
  table: 'messages',
  ...overrides,
});

describe('isDrizzleQueryError', () => {
  it('recognises the wrapper by name', () => {
    expect(isDrizzleQueryError(drizzleQueryError())).toBe(true);
  });

  it('recognises the wrapper by shape when the class identity is lost', () => {
    // Bundler boundaries hand us a plain object carrying the same fields.
    expect(
      isDrizzleQueryError({
        message: 'Failed query: begin params: ',
        params: '',
        query: 'begin',
      }),
    ).toBe(true);
  });

  it('ignores unrelated errors that merely mention "params:"', () => {
    expect(isDrizzleQueryError(new Error('invalid params: missing field'))).toBe(false);
    expect(isDrizzleQueryError(undefined)).toBe(false);
  });
});

describe('toDatabaseTRPCError', () => {
  it('replaces the SQL dump with a message carrying only the reference', () => {
    const original = new TRPCError({
      cause: drizzleQueryError(postgresError(selectLog())),
      code: 'INTERNAL_SERVER_ERROR',
    });

    const mapped = toDatabaseTRPCError(original, { createRef: () => 'db_testref0001' });

    expect(mapped).toBeInstanceOf(TRPCError);
    expect(mapped!.code).toBe('INTERNAL_SERVER_ERROR');
    expect(mapped!.message).toBe('Internal server error (ref: db_testref0001)');
    // The regression: the client used to receive the statement plus its params.
    expect(mapped!.message).not.toContain('Failed query');
    expect(mapped!.message).not.toContain('params:');
    expect(mapped!.message).not.toContain('a user message');
  });

  it('keeps the original error as `cause` so the server log still holds the SQL', () => {
    const original = new TRPCError({
      cause: drizzleQueryError(postgresError(selectLog())),
      code: 'INTERNAL_SERVER_ERROR',
    });

    const mapped = toDatabaseTRPCError(original, { createRef: () => 'db_testref0002' })!;

    expect(mapped.cause).toBe(original);
    expect(collectChainMessages(mapped).join('\n')).toContain('Failed query:');
    expect(collectChainMessages(mapped).join('\n')).toContain('violates foreign key constraint');
  });

  it('logs the reference next to the SQLSTATE and constraint', () => {
    const log = vi.fn();
    const original = new TRPCError({
      cause: drizzleQueryError(postgresError(selectLog())),
      code: 'INTERNAL_SERVER_ERROR',
    });

    toDatabaseTRPCError(original, { createRef: () => 'db_testref0003', log });

    expect(log).toHaveBeenCalledWith({
      column: 'workspace_id',
      constraint: 'messages_workspace_id_workspaces_id_fk',
      error: original,
      ref: 'db_testref0003',
      sqlstate: '23503',
      table: 'messages',
    });
  });

  it('finds the wrapper deeper in the cause chain', () => {
    const original = new TRPCError({
      cause: new Error('reserve failed', { cause: drizzleQueryError(postgresError(selectLog())) }),
      code: 'INTERNAL_SERVER_ERROR',
    });

    const mapped = toDatabaseTRPCError(original, { createRef: () => 'db_testref0004' });

    expect(mapped!.message).toBe('Internal server error (ref: db_testref0004)');
  });

  it('still sanitises when only the wrapped message survived', () => {
    const original = new TRPCError({
      cause: new Error('Failed query: insert into "messages" ("id") values ($1)\nparams: msg_1'),
      code: 'INTERNAL_SERVER_ERROR',
    });

    const mapped = toDatabaseTRPCError(original, { createRef: () => 'db_testref0005' });

    expect(mapped!.message).not.toContain('Failed query');
  });

  it('leaves non-database 500s untouched', () => {
    const original = new TRPCError({
      cause: new Error('boom'),
      code: 'INTERNAL_SERVER_ERROR',
    });

    expect(toDatabaseTRPCError(original)).toBeUndefined();
  });

  it('does not override codes routers chose deliberately', () => {
    const original = new TRPCError({
      cause: drizzleQueryError(postgresError(selectLog())),
      code: 'CONFLICT',
    });

    expect(toDatabaseTRPCError(original)).toBeUndefined();
  });
});

describe('createDatabaseErrorRef', () => {
  it('produces a greppable, unique reference', () => {
    const first = createDatabaseErrorRef();
    const second = createDatabaseErrorRef();

    expect(first).toMatch(/^db_[0-9a-f]{12}$/);
    expect(first).not.toBe(second);
  });
});

const createRouter = (thrown: unknown) => {
  const appRouter = trpc.router({
    run: trpc.procedure.use(databaseError).mutation(() => {
      throw thrown;
    }),
  });

  return createCallerFactory(appRouter);
};

const callWith = async (thrown: unknown) => {
  const caller = createRouter(thrown)(await createContextInner());
  return caller.run().catch((error: TRPCError) => error);
};

describe('databaseError middleware', () => {
  it('hands the client a reference instead of the statement and its params', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const error = await callWith(drizzleQueryError(postgresError(selectLog())));

      expect(error).toBeInstanceOf(TRPCError);
      expect(error.message).toMatch(/^Internal server error \(ref: db_[0-9a-f]{12}\)$/);
      expect(collectChainMessages(error).join('\n')).toContain('Failed query:');

      // The reference the user is given is the one written next to the SQLSTATE,
      // so the log line is reachable from the message alone.
      const ref = error.message.match(/ref: (db_[0-9a-f]{12})/)?.[1];
      expect(ref).toBeDefined();

      const loggedLines = logged.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
      expect(loggedLines).toContain(`ref=${ref}`);
      expect(loggedLines).toContain('sqlstate=23503');
      // The statement itself is kept server-side under the same reference.
      expect(loggedLines).toContain(`[db-error] ${ref} original`);
      expect(loggedLines).toContain('Failed query:');
    } finally {
      logged.mockRestore();
    }
  });

  it('leaves plain errors on their original message', async () => {
    const error = await callWith(new Error('boom'));

    expect(error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(error.message).toBe('boom');
  });
});

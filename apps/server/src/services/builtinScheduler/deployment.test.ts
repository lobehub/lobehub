import { describe, expect, it } from 'vitest';

import { getScheduledTaskDispatch } from './deployment';

const selfHosted = { DATABASE_URL: 'postgres://db', NODE_ENV: 'production' };

describe('getScheduledTaskDispatch', () => {
  it('leaves schedules to QStash once they are registered', () => {
    expect(
      getScheduledTaskDispatch({
        ...selfHosted,
        QSTASH_SCHEDULES_MANAGED: '1',
        QSTASH_TOKEN: 'token',
      }),
    ).toBe('qstash');
  });

  it('trusts a QStash token on a serverless host, where nothing else can run schedules', () => {
    expect(
      getScheduledTaskDispatch({ ...selfHosted, QSTASH_TOKEN: 'token', VERCEL_ENV: 'production' }),
    ).toBe('qstash');
    expect(
      getScheduledTaskDispatch({ ...selfHosted, NETLIFY: 'true', QSTASH_TOKEN: 'token' }),
    ).toBe('qstash');
  });

  it('runs the built-in scheduler on a long-running server without QStash', () => {
    expect(getScheduledTaskDispatch(selfHosted)).toBe('builtin');
  });

  it('runs the built-in scheduler when a token is set but no QStash Schedules are registered', () => {
    // `next start` with a token for the agent runtime queue: nothing registers the schedules.
    expect(getScheduledTaskDispatch({ ...selfHosted, QSTASH_TOKEN: 'token' })).toBe('builtin');
  });

  it('reports nothing to run schedules on a serverless host without QStash', () => {
    expect(getScheduledTaskDispatch({ ...selfHosted, VERCEL_ENV: 'production' })).toBe(
      'unconfigured',
    );
    expect(getScheduledTaskDispatch({ ...selfHosted, NETLIFY: 'true' })).toBe('unconfigured');
    expect(getScheduledTaskDispatch({ ...selfHosted, AWS_LAMBDA_FUNCTION_NAME: 'fn' })).toBe(
      'unconfigured',
    );
  });

  it('reports nothing to run schedules without a server database', () => {
    expect(getScheduledTaskDispatch({ NODE_ENV: 'production' })).toBe('unconfigured');
  });

  it('keeps a dev server from running schedules unless opted in', () => {
    const dev = { DATABASE_URL: 'postgres://db', NODE_ENV: 'development' };

    expect(getScheduledTaskDispatch(dev)).toBe('unconfigured');
    expect(getScheduledTaskDispatch({ ...dev, QSTASH_TOKEN: 'token' })).toBe('unconfigured');
    expect(getScheduledTaskDispatch({ ...dev, ENABLE_SCHEDULER_IN_DEV: '1' })).toBe('builtin');
  });
});

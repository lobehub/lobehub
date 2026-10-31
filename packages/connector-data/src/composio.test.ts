import { describe, expect, it, vi } from 'vitest';

import { createComposioToolRunner, readComposioField, readComposioToolVersion } from './composio';
import { ConnectorDataError } from './errors';

describe('readComposioField', () => {
  it('follows a bounded number of data wrappers', () => {
    expect(readComposioField({ issues: [1] }, 'issues')).toEqual([1]);
    expect(readComposioField({ data: { data: { values: [2] } } }, 'values')).toEqual([2]);
    expect(readComposioField({ data: { data: { data: { data: { x: 1 } } } } }, 'x')).toBe(
      undefined,
    );
  });
});

describe('readComposioToolVersion', () => {
  it('accepts only explicit, safe versions', () => {
    expect(readComposioToolVersion('20261001_00')).toBe('20261001_00');
    expect(readComposioToolVersion('latest')).toBeUndefined();
    expect(readComposioToolVersion('bad version')).toBeUndefined();
  });
});

describe('createComposioToolRunner', () => {
  const setup = (execute: ReturnType<typeof vi.fn>) => {
    const getRawComposioToolBySlug = vi.fn(async () => ({ version: '20261001_00' }));
    const run = createComposioToolRunner('jira', {
      composio: { tools: { execute, getRawComposioToolBySlug } },
      connectedAccountId: 'ca_1',
      userId: 'owner',
    });
    return { getRawComposioToolBySlug, run };
  };

  it('pins the discovered version once per tool and returns the data payload', async () => {
    const execute = vi.fn(async () => ({ data: { issues: [] }, successful: true }));
    const { getRawComposioToolBySlug, run } = setup(execute);

    await expect(run('JIRA_X', 'op', { a: 1 })).resolves.toEqual({ issues: [] });
    await run('JIRA_X', 'op', { a: 2 });

    expect(getRawComposioToolBySlug).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenLastCalledWith('JIRA_X', {
      arguments: { a: 2 },
      connectedAccountId: 'ca_1',
      userId: 'owner',
      version: '20261001_00',
    });
  });

  it('turns an unsuccessful result into a connector error with the provider message', async () => {
    const execute = vi.fn(async () => ({
      error: 'Unauthorized; scope does not match',
      successful: false,
    }));
    const { run } = setup(execute);

    const error = await run('JIRA_X', 'listProjects', {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConnectorDataError);
    expect(error).toMatchObject({
      code: 'jira_listProjects_failed',
      message: 'Unauthorized; scope does not match',
      provider: 'jira',
      retryable: false,
    });
  });
});

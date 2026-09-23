import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSandboxWorkspaceClient, SandboxWorkspaceFilesError } from '../workspaceFiles';

const client = createSandboxWorkspaceClient({ baseURL: 'http://market.test', headers: {} });

const respond = (status: number, body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
        status,
      }),
    ),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSandboxWorkspaceClient', () => {
  it('should surface the market reason when a request fails', async () => {
    // The market answers a failed file operation with OAuth-style
    // `error` / `error_description`, not `message`.
    respond(500, {
      error: 'tool_execution_failed',
      error_description: 'Could not delete: reports',
    });

    const error = await client.deleteFile({ path: 'reports', recursive: true }).catch((e) => e);

    expect(error).toBeInstanceOf(SandboxWorkspaceFilesError);
    expect(error.status).toBe(500);
    expect(error.message).toBe('Could not delete: reports');
  });

  it('should fall back to the status when the body carries no reason', async () => {
    respond(500, { error: 'workspace_delete_failed' });

    const error = await client.deleteFile({ path: 'reports' }).catch((e) => e);

    expect(error.message).toBe('Workspace request failed with status 500');
  });

  it('should send a build its specification as JSON', async () => {
    // Without the content type the market parses no body at all and answers
    // every build with "specification: Required".
    respond(200, { data: { buildId: 'build-1' } });

    await client.buildEnvironment({
      name: 'env-1',
      specification: { sources: [{ kind: 'git', url: 'https://github.com/a/b' }] },
    });

    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe(
      'http://market.test/api/v1/sandbox/workspaces/current/environments/env-1/build',
    );
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body).specification.sources[0].url).toBe('https://github.com/a/b');
  });

  it('should read one environment run history from the control plane', async () => {
    const page = { nextBefore: null, sessions: [] };
    respond(200, { data: page });

    const result = await client.listEnvironmentSessions({
      before: '2026-09-01T00:00:00.000Z',
      limit: 5,
      name: 'env id',
    });

    expect(result).toEqual(page);
    const [url] = (fetch as any).mock.calls[0];
    expect(url).toBe(
      'http://market.test/api/v1/sandbox/workspaces/current/environments/env%20id/sessions?limit=5&before=2026-09-01T00%3A00%3A00.000Z',
    );
  });
});

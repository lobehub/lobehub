import { describe, expect, it, vi } from 'vitest';

import { WidgetModel } from '@/database/models/widget';

import { executeWidgetRun } from '../executeRun';

vi.mock('@/database/models/widget', () => ({
  WidgetModel: { finishRun: vi.fn(async () => ({ folded: false, run: { id: 'run-1' } })) },
}));
vi.mock('../metrics', () => ({ recordWidgetMetrics: vi.fn() }));

const inject = [
  {
    header: 'Authorization',
    host: 'api.github.com',
    prefix: 'Bearer ',
    secretRef: { key: 'github' },
  },
];

const params = {
  run: { id: 'run-1', trigger: 'manual' },
  version: {
    manifest: {
      env: [{ connector: 'github', name: 'GITHUB_TOKEN' }],
      network: { allow: ['api.github.com'] },
    },
    outputType: 'stat',
    publishedByUserId: null,
    runtime: 'node',
    script: 'console.log("{}")',
    userId: 'u1',
  },
  widget: {
    agentId: null,
    id: 'widget-1',
    metricId: null,
    projectId: null,
    title: 'Stars',
    userId: 'u1',
    workspaceId: null,
  },
} as any;

describe('executeWidgetRun', () => {
  it('passes the allowlist to env resolution and forwards Market injects to the sandbox', async () => {
    const resolveEnv = vi.fn(async () => ({
      env: { GITHUB_TOKEN: 'lh_ph_0123456789abcdef' },
      inject,
    }));
    const run = vi.fn(async () => ({
      durationMs: 10,
      exitCode: 0,
      stderr: 'sent lh_ph_0123456789abcdef',
      stdout: '{"type":"stat","value":1}',
      timedOut: false,
    }));

    await executeWidgetRun({} as any, params, { resolveEnv, runner: { run } });

    expect(resolveEnv).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ authorUserId: 'u1' }),
      params.version.manifest.env,
      { networkAllow: ['api.github.com'] },
    );
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { GITHUB_TOKEN: 'lh_ph_0123456789abcdef' },
        network: { allow: ['api.github.com'], inject },
      }),
    );
    // The placeholder is redacted like any env value; it never breaks the run.
    expect(vi.mocked(WidgetModel.finishRun)).toHaveBeenCalledWith(
      {},
      'run-1',
      expect.objectContaining({ status: 'succeeded', stderr: 'sent [REDACTED:GITHUB_TOKEN]' }),
      // the transactional metric publisher `finishRun` folds into the same tx
      expect.any(Function),
    );
  });

  it('sends no inject list when nothing needs one', async () => {
    const run = vi.fn(async () => ({
      durationMs: 10,
      exitCode: 0,
      stderr: '',
      stdout: '{"type":"stat","value":1}',
      timedOut: false,
    }));

    await executeWidgetRun({} as any, params, {
      resolveEnv: vi.fn(async () => ({ env: {}, inject: [] })),
      runner: { run },
    });

    expect((run.mock.calls[0] as any[])[0].network).toEqual({ allow: ['api.github.com'] });
  });
});

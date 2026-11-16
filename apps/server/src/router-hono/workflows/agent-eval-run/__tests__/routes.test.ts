import { describe, expect, it, vi } from 'vitest';

import { signInternalCallback } from '@/libs/qstash/internalSignature';
import { WORKFLOW_PATHS } from '@/server/workflows/agentEvalRun';

import workflowsApp from '../../index';

/**
 * The agent-eval-run pipeline dispatches to itself by absolute URL
 * (`AgentEvalRunWorkflow.trigger*` → `WORKFLOW_PATHS`). Since the endpoints moved
 * from Next.js route segments to a Hono sub-app, a path typo no longer breaks the
 * build — it silently 404s the whole run. Pin the mount against the dispatch table.
 */
describe('agent-eval-run hono routes', () => {
  const registered = new Set(
    workflowsApp.routes.filter((route) => route.method === 'POST').map((route) => route.path),
  );

  it.each(Object.entries(WORKFLOW_PATHS))('serves %s at %s', (_name, path) => {
    expect(registered).toContain(path);
  });

  it('registers every eval endpoint under the shared /api/workflows base path', () => {
    const evalRoutes = [...registered].filter((path) =>
      path.startsWith('/api/workflows/agent-eval-run/'),
    );

    expect(evalRoutes.sort()).toEqual(Object.values(WORKFLOW_PATHS).slice().sort());
  });
});

describe('workflow production authentication boundary', () => {
  it('accepts internally signed eval completion callbacks when QStash is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', 'current-test-key');
    vi.stubEnv('QSTASH_NEXT_SIGNING_KEY', 'next-test-key');
    vi.stubEnv('KEY_VAULTS_SECRET', 'synthetic-test-secret');
    vi.stubEnv('APP_URL', 'https://app.example');
    vi.stubEnv('INTERNAL_APP_URL', '');
    try {
      for (const path of [WORKFLOW_PATHS.onTrajectoryComplete, WORKFLOW_PATHS.onThreadComplete]) {
        const url = `https://app.example${path}`;
        const body = '{}';
        const response = await workflowsApp.request(url, {
          body,
          headers: signInternalCallback(url, body),
          method: 'POST',
        });
        // Auth passed; the handler rejects the empty payload before it reads the database.
        expect(response.status, path).toBe(400);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects unsigned requests across all mounted workflow POST routes without QStash', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', '');
    vi.stubEnv('QSTASH_NEXT_SIGNING_KEY', '');
    try {
      const routes = new Set(
        workflowsApp.routes.filter((route) => route.method === 'POST').map((route) => route.path),
      );
      for (const path of routes) {
        const response = await workflowsApp.request(path.replace(':workflowId', 'process'), {
          body: '{}',
          method: 'POST',
        });
        expect(response.status, path).toBe(401);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

import { describe, expect, it } from 'vitest';

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

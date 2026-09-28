import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { describe, expect, it } from 'vitest';

import { buildSpecDocument } from './spec';

describe('public eval creation response contracts', () => {
  it('documents resource creation and agent duplication as 201, and run acceptance as 202', async () => {
    const app = new Hono();
    const paths = [
      '/api/v1/eval/benchmarks',
      '/api/v1/eval/datasets',
      '/api/v1/eval/datasets/:datasetId/test-cases',
      '/api/v1/agents/:id/duplicate',
    ];
    for (const path of paths)
      app.post(path, describeRoute({ summary: 'Create resource' }), (c) => c.json({}, 201));
    app.post('/api/v1/eval/runs', describeRoute({ summary: 'Create run' }), (c) => c.json({}, 202));
    const spec = await buildSpecDocument(app);
    for (const path of paths) {
      const key = path.replaceAll(/:([^/]+)/g, '{$1}');
      const responses = spec.paths![key].post!.responses!;
      expect(responses).toHaveProperty('201');
      expect(responses).not.toHaveProperty('200');
    }
    expect(spec.paths!['/api/v1/eval/runs'].post!.responses).toHaveProperty('202');
  });
});

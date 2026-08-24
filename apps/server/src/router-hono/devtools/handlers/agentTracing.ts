import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Context } from 'hono';

const TRACING_DIR = '.agent-tracing';

/**
 * Lists the local agent-tracing snapshots, or streams one back when `?file=` is
 * given. Guarded by the `devOnly` middleware.
 */
export const agentTracing = async (c: Context) => {
  const file = c.req.query('file');
  const root = path.resolve(process.cwd(), TRACING_DIR);

  if (file) {
    const safe = path.basename(file);
    const fullPath = path.join(root, safe);
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      return c.body(content, 200, { 'content-type': 'application/json' });
    } catch {
      return c.json({ error: 'not found' }, 404);
    }
  }

  try {
    const files = await fs.readdir(root);
    const items = files.filter((f) => f.endsWith('.json') && f !== 'latest.json');
    return c.json({ files: items });
  } catch {
    return c.json({ files: [] });
  }
};

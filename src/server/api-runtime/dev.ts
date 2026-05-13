import { promises as fs } from 'node:fs';
import path from 'node:path';

const TRACING_DIR = '.agent-tracing';

export const agentTracingAPIHandler = async (request: Request) => {
  if (process.env.NODE_ENV !== 'development') {
    return Response.json({ error: 'dev only' }, { status: 404 });
  }

  const url = new URL(request.url);
  const file = url.searchParams.get('file');
  const root = path.resolve(process.cwd(), TRACING_DIR);

  if (file) {
    const safe = path.basename(file);
    const fullPath = path.join(root, safe);

    try {
      const content = await fs.readFile(fullPath, 'utf8');
      return new Response(content, {
        headers: { 'content-type': 'application/json' },
      });
    } catch {
      return Response.json({ error: 'not found' }, { status: 404 });
    }
  }

  try {
    const files = await fs.readdir(root);
    const items = files.filter((item) => item.endsWith('.json') && item !== 'latest.json');

    return Response.json({ files: items });
  } catch {
    return Response.json({ files: [] });
  }
};

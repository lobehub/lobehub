import { promises as fs } from 'node:fs';
import path from 'node:path';

import { NextResponse } from 'next/server';

const TRACING_DIR = '.agent-tracing';

export async function GET(req: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'dev only' }, { status: 404 });
  }

  const url = new URL(req.url);
  const file = url.searchParams.get('file');
  const root = path.resolve(process.cwd(), TRACING_DIR);

  if (file) {
    const safe = path.basename(file);
    const fullPath = path.join(root, safe);
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      return new NextResponse(content, {
        headers: { 'content-type': 'application/json' },
      });
    } catch {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
  }

  try {
    const files = await fs.readdir(root);
    const items = files.filter((f) => f.endsWith('.json') && f !== 'latest.json');
    return NextResponse.json({ files: items });
  } catch {
    return NextResponse.json({ files: [] });
  }
}

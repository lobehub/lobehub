import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const source = await readFile(path.join(import.meta.dirname, 'startServer.js'), 'utf8');

describe('server launcher QStash schedules', () => {
  it('registers the hourly recycle-bin retention sweep', () => {
    expect(source).toMatch(
      /cron: '0 \* \* \* \*',[\s\S]*id: 'lobe-trash-purge',[\s\S]*path: '\/api\/workflows\/trash\/purge'/,
    );
  });
});

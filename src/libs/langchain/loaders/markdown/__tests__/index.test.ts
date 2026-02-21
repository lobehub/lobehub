// @vitest-environment node
import * as fs from 'node:fs';
import { join } from 'node:path';

import { MarkdownLoader } from '../index';

describe('MarkdownLoader', () => {
  it('should run', async () => {
    const content = fs.readFileSync(join(__dirname, `./demo.mdx`), 'utf8');

    await MarkdownLoader(content);
  });
});

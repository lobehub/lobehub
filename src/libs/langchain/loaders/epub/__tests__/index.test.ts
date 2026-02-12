// @vitest-environment node
import * as fs from 'node:fs';
import { join } from 'node:path';

import { expect } from 'vitest';

import { EPubLoader } from '../index';

function sanitizeDynamicFields(document: any[]) {
  for (const doc of document) {
    doc.metadata.source && (doc.metadata.source = '');
  }
  return document;
}

describe('EPubLoader', () => {
  it('should run', async () => {
    const content = fs.readFileSync(join(__dirname, `./demo.epub`));

    const fileContent: Uint8Array = new Uint8Array(content);

    const data = await EPubLoader(fileContent);
    expect(sanitizeDynamicFields(data)).toMatchSnapshot();
  });
});

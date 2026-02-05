// @vitest-environment node
import * as fs from 'node:fs';
import { join } from 'node:path';

import { expect } from 'vitest';

import { CsVLoader } from '../index';

describe('CSVLoader', () => {
  it('should run', async () => {
    const content = fs.readFileSync(join(__dirname, `./demo.csv`), 'utf8');

    const fileBlob = new Blob([Buffer.from(content)]);

    const data = await CsVLoader(fileBlob);

    expect(data).toMatchSnapshot();
  });
});

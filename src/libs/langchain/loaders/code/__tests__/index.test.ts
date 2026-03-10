// @vitest-environment node
import * as fs from 'node:fs';
import { join } from 'node:path';

import { CodeLoader } from '../index';
import longResult from './long.json';

describe('CodeLoader', () => {
  it('split simple code', async () => {
    const jsCode = `function helloWorld() {
  console.log("Hello, World!");
}
// Call the function
helloWorld();`;

    const result = await CodeLoader(jsCode, 'js');

    expect(result).toEqual([
      {
        pageContent:
          'function helloWorld() {\n  console.log("Hello, World!");\n}\n// Call the function\nhelloWorld();',
        metadata: { loc: { lines: { from: 1, to: 5 } } },
      },
    ]);
  });

  it('split long', async () => {
    const code = fs.readFileSync(join(__dirname, `./long.txt`), 'utf8');

    const result = await CodeLoader(code, 'js');

    expect(result).toEqual(longResult);
  });
});

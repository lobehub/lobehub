// @vitest-environment node
import * as fs from 'node:fs';
import { join } from 'node:path';

import { CodeLoader } from '../index';

describe('CodeLoader', () => {
  it('split simple code', async () => {
    const jsCode = `function helloWorld() {
  console.log("Hello, World!");
}
// Call the function
helloWorld();`;

    const result = await CodeLoader(jsCode, 'js');

    expect(result).toHaveLength(1);
    expect(result[0].pageContent).toBe(
      'function helloWorld() {\n  console.log("Hello, World!");\n}\n// Call the function\nhelloWorld();',
    );
    expect(result[0].metadata.loc.lines.from).toBe(1);
    expect(result[0].metadata.loc.lines.to).toBe(5);
  });

  it('split long', async () => {
    const code = fs.readFileSync(join(__dirname, `./long.txt`), 'utf8');

    const result = await CodeLoader(code, 'js');

    // Should split long code into multiple chunks
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.pageContent).toBeTruthy();
      expect(chunk.metadata.loc.lines).toBeDefined();
    }
  });
});

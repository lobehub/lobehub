// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { splitCode, splitText } from '../index';

const config = { chunkOverlap: 400, chunkSize: 800 };

describe('splitter line locations', () => {
  it('reports the lines each chunk spans in a file that splits into many chunks', () => {
    const lines = Array.from(
      { length: 400 },
      (_, i) => `const value${i} = compute(${i}); // line ${i + 1}`,
    );
    const text = lines.join('\n');

    const chunks = splitText(text, config);

    expect(chunks.length).toBeGreaterThan(10);
    for (const chunk of chunks) {
      const chunkLines = chunk.pageContent.split('\n');
      const { from, to } = chunk.metadata.loc.lines;
      // every source line carries its own number, so the expected span is read off the chunk
      expect(lines[from - 1]).toContain(chunkLines[0]);
      expect(lines[to - 1]).toContain(chunkLines.at(-1));
      expect(to - from + 1).toBe(chunkLines.length);
    }
  });

  it('keeps counting lines across blank lines and repeated content', () => {
    const block = 'function same() {\n  return 1;\n}\n';
    const text = Array.from({ length: 120 }, () => block).join('\n');

    const chunks = splitCode(text, 'js', config);

    expect(chunks.length).toBeGreaterThan(2);
    let previousFrom = 1;
    for (const chunk of chunks) {
      const { from, to } = chunk.metadata.loc.lines;
      expect(from).toBeGreaterThanOrEqual(previousFrom);
      expect(to - from).toBe(chunk.pageContent.split('\n').length - 1);
      previousFrom = from;
    }
    expect(chunks.at(-1)!.metadata.loc.lines.to).toBeLessThanOrEqual(text.split('\n').length);
  });
});

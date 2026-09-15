import { describe, expect, it } from 'vitest';

import { canonicalizeGeneratedMarkdownProof } from './proof';

const fragmentedText = (parts: string[]) => ({
  root: {
    children: parts.map((text, index) => ({
      $: { properties: { nodeId: `fragment-${index}` } },
      detail: 0,
      format: 0,
      mode: 'normal',
      style: '',
      text,
      type: 'text',
      version: 1,
    })),
    type: 'root',
    version: 1,
  },
});

describe('generated Markdown completion proof', () => {
  it('does not introduce spaces at streamed text-node boundaries', () => {
    const parts = ['运动（', 'tennis', '）组合。\n\n', '下一段。'];
    const output = parts.join('');
    expect(canonicalizeGeneratedMarkdownProof(fragmentedText(parts), output, output)).toBe(true);
  });

  it('still rejects a missing text fragment', () => {
    const output = '运动（tennis）组合。';
    const partial = '运动（）组合。';
    expect(
      canonicalizeGeneratedMarkdownProof(fragmentedText(['运动（', '）组合。']), output, partial),
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { chainAbstractChunkText } from '../abstractChunk';

describe('chainAbstractChunkText', () => {
  it('should generate correct chat payload for chunk text', () => {
    const testText = 'This is a sample chunk of text that needs to be summarized.';

    const result = chainAbstractChunkText(testText);

    expect(result).toMatchSnapshot();
  });

  it('should handle text with special characters', () => {
    const testText = 'Text with special chars: @#$%^&*()';

    const result = chainAbstractChunkText(testText);

    expect(result.messages![1].content).toBe(testText);
  });

  it('should always use system role for first message', () => {
    const result = chainAbstractChunkText('test');

    expect(result.messages![0].role).toBe('system');
  });

  it('should always use user role for second message', () => {
    const result = chainAbstractChunkText('test');

    expect(result.messages![1].role).toBe('user');
  });
});

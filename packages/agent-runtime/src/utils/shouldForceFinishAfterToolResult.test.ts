import type { ChatToolPayload } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { shouldForceFinishAfterToolResult } from './shouldForceFinishAfterToolResult';

const createToolCall = (overrides?: Partial<ChatToolPayload>): ChatToolPayload => ({
  apiName: 'edit_image',
  arguments: '{}',
  id: 'tool-call-1',
  identifier: 'doubao_grok',
  type: 'mcp',
  ...overrides,
});

describe('shouldForceFinishAfterToolResult', () => {
  it('returns true for successful terminal image edit results', () => {
    expect(
      shouldForceFinishAfterToolResult({
        isSuccess: true,
        result: {
          kind: 'edit_image',
          result: 'https://example.com/generated/image.jpg',
        },
        toolCall: createToolCall(),
      }),
    ).toBe(true);
  });

  it('returns false for non-terminal tools even when urls are present', () => {
    expect(
      shouldForceFinishAfterToolResult({
        isSuccess: true,
        result: {
          results: ['https://example.com/image-1.jpg', 'https://example.com/image-2.jpg'],
        },
        toolCall: createToolCall({ apiName: 'search_images', identifier: 'web-search' }),
      }),
    ).toBe(false);
  });

  it('returns false when media tool succeeds without concrete output', () => {
    expect(
      shouldForceFinishAfterToolResult({
        isSuccess: true,
        result: { kind: 'edit_image', status: 'queued' },
        toolCall: createToolCall(),
      }),
    ).toBe(false);
  });
});

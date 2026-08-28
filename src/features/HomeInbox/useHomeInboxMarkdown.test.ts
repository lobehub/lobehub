import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import LinkElement from '@/features/Conversation/Markdown/plugins/Link';

import { useHomeInboxMarkdown } from './useHomeInboxMarkdown';

describe('useHomeInboxMarkdown', () => {
  it('wires only the provider-free link plugin', () => {
    const { result } = renderHook(() => useHomeInboxMarkdown('message-1'));

    expect(Object.keys(result.current.components ?? {})).toEqual([LinkElement.tag]);
    expect(result.current.rehypePlugins).toEqual([LinkElement.rehypePlugin]);
    expect(result.current.remarkPlugins).toBeUndefined();
  });
});

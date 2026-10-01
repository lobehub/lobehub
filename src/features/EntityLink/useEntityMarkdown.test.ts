import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import EntityLinkElement from './element';
import { useEntityMarkdown } from './useEntityMarkdown';

describe('useEntityMarkdown', () => {
  it('mounts only the provider-free entity link element', () => {
    const { result } = renderHook(() => useEntityMarkdown());

    expect(Object.keys(result.current.components ?? {})).toEqual([EntityLinkElement.tag]);
    expect(result.current.rehypePlugins).toEqual([EntityLinkElement.rehypePlugin]);
    expect(result.current.remarkPlugins).toBeUndefined();
  });
});

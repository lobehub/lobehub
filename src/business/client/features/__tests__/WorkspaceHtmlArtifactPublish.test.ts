import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useWorkspaceHtmlArtifactPublish } from '../WorkspaceHtmlArtifactPublish';

describe('useWorkspaceHtmlArtifactPublish (oss stub)', () => {
  it('reports the publisher as unavailable', async () => {
    const { result } = renderHook(() => useWorkspaceHtmlArtifactPublish());

    expect(result.current.available).toBe(false);
    await expect(
      result.current.getExisting({ identifier: 'workspace-html-index-html', topicId: 'tpc_1' }),
    ).resolves.toBeNull();
    await expect(
      result.current.publish({
        entryPath: 'index.html',
        files: [],
        identifier: 'workspace-html-index-html',
        title: 'Demo',
        topicId: 'tpc_1',
      }),
    ).rejects.toThrow('unavailable');
  });

  it('keeps the publisher referentially stable across renders', () => {
    const { rerender, result } = renderHook(() => useWorkspaceHtmlArtifactPublish());
    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
    expect(result.current.getExisting).toBe(first.getExisting);
  });
});

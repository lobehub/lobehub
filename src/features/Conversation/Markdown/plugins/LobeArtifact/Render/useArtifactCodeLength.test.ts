import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat';

import { useArtifactCodeLength } from './useArtifactCodeLength';

const MESSAGE_ID = 'msg-artifact';

const setMessageContent = (content: string) => {
  useChatStore.setState({
    dbMessagesMap: { test: [{ content, id: MESSAGE_ID, role: 'assistant' } as any] },
  });
};

describe('useArtifactCodeLength', () => {
  afterEach(() => {
    useChatStore.setState({ dbMessagesMap: {} });
  });

  it('counts inline-markdown syntax that the rendered children lose', () => {
    // Markdown would turn the paired backticks into inline code, which the rehype plugin drops
    const code = 'const label = `count: ${n}`;';
    setMessageContent(
      `<lobeArtifact identifier="demo" type="text/html" title="Demo">${code}</lobeArtifact>`,
    );

    const { result } = renderHook(() => useArtifactCodeLength(MESSAGE_ID, 'demo'));

    expect(result.current).toBe(code.length);
  });

  it('counts the streamed tail of an unclosed artifact', () => {
    setMessageContent('<lobeArtifact identifier="demo" type="text/html" title="Demo"><svg><rect');

    const { result } = renderHook(() => useArtifactCodeLength(MESSAGE_ID, 'demo'));

    expect(result.current).toBe('<svg><rect'.length);
  });
});

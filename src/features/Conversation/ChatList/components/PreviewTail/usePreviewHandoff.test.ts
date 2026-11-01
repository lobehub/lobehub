import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TopicPreview } from '@/services/message/topicPreview';

import { usePreviewHandoff } from './usePreviewHandoff';
import { waitForAnswerInView } from './waitForAnswerInView';

vi.mock('./waitForAnswerInView', () => ({ waitForAnswerInView: vi.fn(() => vi.fn()) }));

const wait = vi.mocked(waitForAnswerInView);

const preview = { message: { id: 'msg_final' }, topicId: 'tpc_a' } as TopicPreview;

interface Props {
  contextKey: string;
  listMounted: boolean;
  preview?: TopicPreview;
}

const setup = (initial: Props) => {
  const listRef = { current: document.createElement('div') };
  return renderHook((props: Props) => usePreviewHandoff({ ...props, listRef }), {
    initialProps: initial,
  });
};

describe('usePreviewHandoff', () => {
  beforeEach(() => {
    wait.mockClear();
  });

  it('keeps the preview over the list until the list shows the final answer', () => {
    const { rerender, result } = setup({ contextKey: 'a', listMounted: false, preview });
    rerender({ contextKey: 'a', listMounted: true, preview: undefined });

    expect(result.current).toBe(preview);
    expect(wait).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'msg_final' }));

    act(() => wait.mock.calls[0][0].onReady());

    expect(result.current).toBeUndefined();
  });

  it('does not cover a list the preview was never shown for', () => {
    const { result } = setup({ contextKey: 'a', listMounted: true, preview: undefined });

    expect(result.current).toBeUndefined();
    expect(wait).not.toHaveBeenCalled();
  });

  it('drops a held preview once the user moves to another topic', () => {
    const { rerender, result } = setup({ contextKey: 'a', listMounted: false, preview });
    rerender({ contextKey: 'b', listMounted: true, preview: undefined });

    expect(result.current).toBeUndefined();

    rerender({ contextKey: 'a', listMounted: true, preview: undefined });

    expect(result.current).toBeUndefined();
  });
});

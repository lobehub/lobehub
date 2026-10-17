import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type FieldType } from '../ShareText/type';
import { useSharePdfExport } from './useSharePdfExport';

const generatePdf = vi.fn();
const shareData = vi.fn();

vi.mock('./usePdfGeneration', () => ({
  usePdfGeneration: () => ({
    downloadPdf: vi.fn(),
    error: null,
    generatePdf,
    loading: false,
    pdfData: null,
  }),
}));

vi.mock('../ShareDataProvider', () => ({ useShareData: () => shareData() }));

vi.mock('../ShareText/template', () => ({
  generateMarkdown: ({ messages }: { messages: unknown[] }) =>
    messages.length > 0 ? '# Topic\n\nhello' : '',
}));

const fields: FieldType = {
  includeTool: true,
  includeUser: true,
  withRole: true,
  withSystemRole: false,
};

const message = { content: 'hello', id: 'm1', role: 'user' };

describe('useSharePdfExport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    generatePdf.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders for the shared agent even when the chat store has no active agent', () => {
    shareData.mockReturnValue({
      context: { agentId: 'agent-from-context', topicId: 'topic-1' },
      displayMessages: [message],
      systemRole: '',
      title: 'Topic',
    });

    renderHook(() => useSharePdfExport(fields));
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(generatePdf).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'agent-from-context', topicId: 'topic-1' }),
    );
  });

  it('reports an empty export instead of waiting on a render that never starts', () => {
    shareData.mockReturnValue({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      displayMessages: [],
      systemRole: '',
      title: 'Topic',
    });

    const { result } = renderHook(() => useSharePdfExport(fields));
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(result.current.isEmpty).toBe(true);
    expect(generatePdf).not.toHaveBeenCalled();
  });

  it('waits for options to settle before rendering again', () => {
    shareData.mockReturnValue({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      displayMessages: [message],
      systemRole: '',
      title: 'Topic',
    });

    const { rerender } = renderHook(() => useSharePdfExport(fields));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    shareData.mockReturnValue({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      displayMessages: [message],
      systemRole: '',
      title: 'Renamed',
    });
    rerender();
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(generatePdf).toHaveBeenCalledTimes(1);
    expect(generatePdf).toHaveBeenCalledWith(expect.objectContaining({ title: 'Renamed' }));
  });
});

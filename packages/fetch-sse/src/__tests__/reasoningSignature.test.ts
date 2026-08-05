import type { FetchEventSourceInit } from '@lobechat/utils/client/fetchEventSource/index';
import { fetchEventSource } from '@lobechat/utils/client/fetchEventSource/index';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSSE } from '../fetchSSE';

vi.mock('@lobechat/model-runtime', () => ({
  parseToolCalls: vi.fn(),
}));

vi.mock('@lobechat/utils/client/fetchEventSource/index', () => ({
  fetchEventSource: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchSSE reasoning signatures', () => {
  it('should preserve a reasoning signature without visible reasoning text', async () => {
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({
          data: JSON.stringify('encrypted-reasoning-content'),
          event: 'reasoning_signature',
        } as any);
        options.onmessage!({ data: JSON.stringify('Done'), event: 'text' } as any);
      },
    );

    await fetchSSE('/', {
      onFinish: mockOnFinish,
      responseAnimation: 'fadeIn',
    });

    expect(mockOnFinish).toHaveBeenCalledWith('Done', {
      observationId: null,
      reasoning: {
        content: undefined,
        signature: 'encrypted-reasoning-content',
      },
      toolCalls: undefined,
      traceId: null,
      type: 'done',
    });
  });

  it('should collect reasoning response items in stream order', async () => {
    const mockOnFinish = vi.fn();
    const firstItem = {
      encrypted_content: 'scoped-encrypted-1',
      id: 'rs_1',
      summary: [{ text: 'visible summary', type: 'summary_text' }],
      type: 'reasoning',
    };
    const secondItem = {
      encrypted_content: 'scoped-encrypted-2',
      id: 'rs_2',
      summary: [],
      type: 'reasoning',
    };

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({
          data: JSON.stringify('visible summary'),
          event: 'reasoning',
        } as any);
        options.onmessage!({
          data: JSON.stringify(firstItem),
          event: 'reasoning_response_item',
        } as any);
        options.onmessage!({
          data: JSON.stringify(secondItem),
          event: 'reasoning_response_item',
        } as any);
        options.onmessage!({ data: JSON.stringify('Done'), event: 'text' } as any);
      },
    );

    await fetchSSE('/', {
      onFinish: mockOnFinish,
      responseAnimation: 'none',
    });

    expect(mockOnFinish).toHaveBeenCalledWith('Done', {
      observationId: null,
      reasoning: {
        content: 'visible summary',
        responseItems: [firstItem, secondItem],
        signature: undefined,
      },
      toolCalls: undefined,
      traceId: null,
      type: 'done',
    });
  });

  it('should derive reasoning content from item summaries when nothing was streamed', async () => {
    const mockOnFinish = vi.fn();
    const summaryItem = {
      encrypted_content: 'scoped-encrypted',
      id: 'rs_1',
      summary: [{ text: 'summary only text', type: 'summary_text' }],
      type: 'reasoning',
    };

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({
          data: JSON.stringify(summaryItem),
          event: 'reasoning_response_item',
        } as any);
        options.onmessage!({ data: JSON.stringify('Done'), event: 'text' } as any);
      },
    );

    await fetchSSE('/', {
      onFinish: mockOnFinish,
      responseAnimation: 'none',
    });

    expect(mockOnFinish).toHaveBeenCalledWith('Done', {
      observationId: null,
      reasoning: {
        content: 'summary only text',
        responseItems: [summaryItem],
        signature: undefined,
      },
      toolCalls: undefined,
      traceId: null,
      type: 'done',
    });
  });

  it('should keep reasoning when only hidden response items arrive', async () => {
    const mockOnFinish = vi.fn();
    const hiddenItem = {
      encrypted_content: 'scoped-hidden',
      id: 'rs_hidden',
      summary: [],
      type: 'reasoning',
    };

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({
          data: JSON.stringify(hiddenItem),
          event: 'reasoning_response_item',
        } as any);
        options.onmessage!({ data: JSON.stringify('Done'), event: 'text' } as any);
      },
    );

    await fetchSSE('/', {
      onFinish: mockOnFinish,
      responseAnimation: 'none',
    });

    expect(mockOnFinish).toHaveBeenCalledWith('Done', {
      observationId: null,
      reasoning: {
        content: undefined,
        responseItems: [hiddenItem],
        signature: undefined,
      },
      toolCalls: undefined,
      traceId: null,
      type: 'done',
    });
  });

  it('should ignore object payloads on the string-only reasoning_signature event', async () => {
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({
          data: JSON.stringify({ id: 'rs_1', type: 'reasoning' }),
          event: 'reasoning_signature',
        } as any);
        options.onmessage!({ data: JSON.stringify('Done'), event: 'text' } as any);
      },
    );

    await fetchSSE('/', {
      onFinish: mockOnFinish,
      responseAnimation: 'none',
    });

    expect(mockOnFinish).toHaveBeenCalledWith('Done', {
      observationId: null,
      reasoning: undefined,
      toolCalls: undefined,
      traceId: null,
      type: 'done',
    });
  });
});

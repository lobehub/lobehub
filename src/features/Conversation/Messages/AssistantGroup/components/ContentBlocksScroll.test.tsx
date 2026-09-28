/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ContentBlocksScroll from './ContentBlocksScroll';
import type { RenderableAssistantContentBlock } from './types';

vi.mock('./ContentBlock', () => ({
  default: ({ disableMarkdownStreaming, id }: RenderableAssistantContentBlock) => (
    <div
      data-block-id={id}
      data-disable-markdown-streaming={String(!!disableMarkdownStreaming)}
      data-testid="content-block"
    />
  ),
}));

describe('ContentBlocksScroll', () => {
  it('does not disable markdown streaming for the first block of a workflow subset', () => {
    render(
      <ContentBlocksScroll
        assistantId="assistant-1"
        blocks={[{ content: 'workflow block', id: 'block-2' }]}
        scroll={false}
        variant="workflow"
      />,
    );

    expect(screen.getByTestId('content-block')).toHaveAttribute(
      'data-disable-markdown-streaming',
      'false',
    );
  });

  it('preserves precomputed markdown streaming disable flag', () => {
    render(
      <ContentBlocksScroll
        assistantId="assistant-1"
        blocks={[{ content: 'first group block', disableMarkdownStreaming: true, id: 'block-1' }]}
        scroll={false}
        variant="workflow"
      />,
    );

    expect(screen.getByTestId('content-block')).toHaveAttribute(
      'data-disable-markdown-streaming',
      'true',
    );
  });

  it('uses a consistent gap between workflow blocks', () => {
    render(
      <ContentBlocksScroll
        assistantId="assistant-1"
        scroll={false}
        variant="workflow"
        blocks={[
          { content: 'first workflow block', id: 'block-1' },
          { content: 'second workflow block', id: 'block-2' },
        ]}
      />,
    );

    const [firstBlock] = screen.getAllByTestId('content-block');
    expect(firstBlock.parentElement!.style.getPropertyValue('--lobe-flex-gap')).toBe('8px');
  });
});

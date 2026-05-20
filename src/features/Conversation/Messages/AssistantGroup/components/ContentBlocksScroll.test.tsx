/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ContentBlocksScroll from './ContentBlocksScroll';
import type { RenderableAssistantContentBlock } from './types';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ScrollArea: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    scrollTask: 'scroll-task',
    scrollWorkflow: 'scroll-workflow',
  }),
}));

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
});

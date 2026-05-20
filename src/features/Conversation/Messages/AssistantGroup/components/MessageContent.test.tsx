/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MessageContent from './MessageContent';

let mockStoreContent = 'original full content';
let mockStoreHasTools = true;

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    pWithTool: 'tool-line',
  }),
  cx: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));

vi.mock('@/features/Conversation/Markdown', () => ({
  default: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className} data-testid="markdown">
      {children}
    </div>
  ),
}));

vi.mock('@/features/Conversation/Messages/components/ContentLoading', () => ({
  default: ({ id }: { id: string }) => <div data-testid="loading">{id}</div>,
}));

vi.mock('../../../store', () => ({
  dataSelectors: {
    getBlockContent: () => () => mockStoreContent,
    getBlockHasTools: () => () => mockStoreHasTools,
  },
  useConversationStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('../useMarkdown', () => ({
  useMarkdown: () => ({}),
}));

describe('MessageContent', () => {
  afterEach(() => {
    cleanup();
    mockStoreContent = 'original full content';
    mockStoreHasTools = true;
  });

  it('renders explicit content override instead of the same-id store content', () => {
    render(
      <MessageContent contentOverride="lead sentence" hasToolsOverride={false} id="block-1" />,
    );

    expect(screen.getByTestId('markdown')).toHaveTextContent('lead sentence');
    expect(screen.queryByText('original full content')).not.toBeInTheDocument();
  });

  it('keeps the store subscription path when no override is provided', () => {
    render(<MessageContent id="block-1" />);

    expect(screen.getByTestId('markdown')).toHaveTextContent('original full content');
  });
});

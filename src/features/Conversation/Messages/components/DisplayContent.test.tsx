import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DisplayContent from './DisplayContent';

const mockDeserializeParts = vi.fn();

vi.mock('@lobechat/utils', () => ({
  deserializeParts: (...args: unknown[]) => mockDeserializeParts(...args),
}));

vi.mock('@/features/Conversation/Markdown', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="markdown-message">{children}</div>,
}));

vi.mock('../../utils/markdown', () => ({
  normalizeThinkTags: (content: string) => content,
  processWithArtifact: (content: string) => content,
}));

vi.mock('./ContentLoading', () => ({
  default: ({ id }: { id: string }) => <div data-testid="content-loading">{id}</div>,
}));

vi.mock('./RichContentRenderer', () => ({
  RichContentRenderer: ({ parts }: { parts: unknown }) => (
    <div data-testid="rich-content">{JSON.stringify(parts)}</div>
  ),
}));

describe('DisplayContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeserializeParts.mockReturnValue(null);
  });

  it('should render loading instead of a blank area while tool calls are generating', () => {
    render(<DisplayContent content={''} id={'msg-1'} isToolCallGenerating />);

    expect(screen.getByTestId('content-loading')).toHaveTextContent('msg-1');
    expect(screen.queryByTestId('markdown-message')).not.toBeInTheDocument();
  });

  it('should render markdown when content is ready', () => {
    render(<DisplayContent content={'hello'} id={'msg-2'} />);

    expect(screen.getByTestId('markdown-message')).toHaveTextContent('hello');
    expect(screen.queryByTestId('content-loading')).not.toBeInTheDocument();
  });
});

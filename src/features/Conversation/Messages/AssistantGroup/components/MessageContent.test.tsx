/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MessageContent from './MessageContent';

let mockStoreContent = 'original full content';
let mockStoreHasTools = true;
let mockIsGenerating = false;
let mockStoreMessage:
  | { createdAt?: number; metadata?: { isMultimodal?: boolean; tempDisplayContent?: string } }
  | undefined = { createdAt: 1000 };

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

vi.mock('@/features/Conversation/Messages/components/RichContentRenderer', () => ({
  RichContentRenderer: ({ parts }: { parts: { image?: string; type: string }[] }) => (
    <div data-testid="rich-content">
      {parts.map((part) =>
        part.type === 'image' ? <img key={part.image} src={part.image} /> : null,
      )}
    </div>
  ),
}));

vi.mock('../../../store', () => ({
  dataSelectors: {
    getBlockContent: () => () => mockStoreContent,
    getBlockHasTools: () => () => mockStoreHasTools,
    getBlockMetadata: () => () => mockStoreMessage?.metadata,
    getDbMessageById: () => () => mockStoreMessage,
  },
  messageStateSelectors: {
    isAssistantGroupItemGenerating: () => () => mockIsGenerating,
  },
  useConversationStore: (selector: (state: unknown) => unknown) => selector({}),
}));

type UseMarkdownArgs = [id: string, disableStreaming?: boolean, content?: string];

const useMarkdownMock = vi.fn((..._args: UseMarkdownArgs) => ({}));

vi.mock('../useMarkdown', () => ({
  useMarkdown: (...args: UseMarkdownArgs) => useMarkdownMock(...args),
}));

describe('MessageContent', () => {
  afterEach(() => {
    cleanup();
    useMarkdownMock.mockClear();
    mockStoreContent = 'original full content';
    mockStoreHasTools = true;
    mockIsGenerating = false;
    mockStoreMessage = { createdAt: 1000 };
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

  it('disables markdown streaming when the block already has tools below the text', () => {
    render(<MessageContent hasToolsOverride contentOverride="lead sentence" id="block-1" />);

    expect(useMarkdownMock).toHaveBeenCalledWith('block-1', true, 'lead sentence');
  });

  it('keeps markdown streaming enabled when the block has no tools and is not disabled', () => {
    render(
      <MessageContent contentOverride="lead sentence" hasToolsOverride={false} id="block-1" />,
    );

    expect(useMarkdownMock).toHaveBeenCalledWith('block-1', false, 'lead sentence');
  });

  it('disables markdown streaming when disableStreaming is set even without tools', () => {
    render(
      <MessageContent
        disableStreaming
        contentOverride="lead sentence"
        hasToolsOverride={false}
        id="block-1"
      />,
    );

    expect(useMarkdownMock).toHaveBeenCalledWith('block-1', true, 'lead sentence');
  });

  it('renders multimodal image parts instead of the raw serialized JSON', () => {
    const imageUrl = 'https://example.com/apple.png';
    mockStoreContent = JSON.stringify([{ image: imageUrl, type: 'image' }]);
    mockStoreHasTools = false;
    mockStoreMessage = { createdAt: 1000, metadata: { isMultimodal: true } };

    render(<MessageContent id="block-1" />);

    expect(screen.getByTestId('rich-content').querySelector('img')).toHaveAttribute(
      'src',
      imageUrl,
    );
    expect(screen.queryByTestId('markdown')).not.toBeInTheDocument();
  });

  describe('a bot that chose not to reply', () => {
    it('renders NO_REPLY:<reason> as the decision with its reason, not the raw token', () => {
      mockStoreContent = 'NO_REPLY:not_addressed';
      mockStoreHasTools = false;

      render(<MessageContent id="block-1" />);

      expect(screen.getByTestId('no-reply-notice')).toHaveTextContent(
        'noReply.title · noReply.reason.not_addressed',
      );
      expect(screen.queryByTestId('markdown')).not.toBeInTheDocument();
    });

    it('renders a bare NO_REPLY as the decision without a reason', () => {
      mockStoreContent = 'NO_REPLY';
      mockStoreHasTools = false;

      render(<MessageContent id="block-1" />);

      expect(screen.getByTestId('no-reply-notice')).toHaveTextContent(/^noReply\.title$/);
      expect(screen.queryByTestId('markdown')).not.toBeInTheDocument();
    });

    it('keeps rendering text that merely mentions NO_REPLY as markdown', () => {
      mockStoreContent = 'I answer NO_REPLY:not_addressed when a message is not for me.';
      mockStoreHasTools = false;

      render(<MessageContent id="block-1" />);

      expect(screen.getByTestId('markdown')).toHaveTextContent(mockStoreContent);
      expect(screen.queryByTestId('no-reply-notice')).not.toBeInTheDocument();
    });

    it('keeps the raw text while the message is still generating', () => {
      mockStoreContent = 'NO_REPLY';
      mockStoreHasTools = false;
      mockIsGenerating = true;

      render(<MessageContent id="block-1" />);

      expect(screen.getByTestId('markdown')).toHaveTextContent('NO_REPLY');
      expect(screen.queryByTestId('no-reply-notice')).not.toBeInTheDocument();
    });

    it('keeps the raw text when the block also has tool calls to show', () => {
      mockStoreContent = 'NO_REPLY';
      mockStoreHasTools = true;

      render(<MessageContent id="block-1" />);

      expect(screen.getByTestId('markdown')).toHaveTextContent('NO_REPLY');
      expect(screen.queryByTestId('no-reply-notice')).not.toBeInTheDocument();
    });
  });
});

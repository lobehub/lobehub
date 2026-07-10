import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MessageContent from './MessageContent';

vi.mock('@/features/Conversation/Markdown', () => ({
  default: ({ children }: any) => <div data-testid="markdown-message">{children}</div>,
}));

vi.mock('../useMarkdown', () => ({
  useMarkdown: () => ({}),
}));

vi.mock('./RichTextMessage', () => ({
  default: ({ editorState }: any) => (
    <div data-testid="rich-message">{JSON.stringify(editorState)}</div>
  ),
}));

vi.mock('./FileListViewer', () => ({
  default: () => null,
}));
vi.mock('./ImageFileListViewer', () => ({
  default: () => null,
}));
vi.mock('./VideoFileListViewer', () => ({
  default: () => null,
}));
vi.mock('./AudioFileListViewer', () => ({
  default: ({ items }: any) => <div data-testid="audio-viewer">{items.length}</div>,
}));

describe('User MessageContent', () => {
  it('should prefer rich text rendering when editorData exists', () => {
    render(
      <MessageContent
        content={'markdown-content'}
        createdAt={Date.now()}
        editorData={{ root: { children: [], type: 'root', version: 1 } }}
        id={'msg-1'}
        role={'user'}
        updatedAt={Date.now()}
      />,
    );

    expect(screen.getByTestId('rich-message')).toBeInTheDocument();
    expect(screen.queryByTestId('markdown-message')).not.toBeInTheDocument();
  });

  it('should render markdown when editorData is missing', () => {
    render(
      <MessageContent
        content={'markdown-content'}
        createdAt={Date.now()}
        id={'msg-2'}
        role={'user'}
        updatedAt={Date.now()}
      />,
    );

    expect(screen.getByTestId('markdown-message')).toBeInTheDocument();
    expect(screen.queryByTestId('rich-message')).not.toBeInTheDocument();
  });

  it('should render the audio viewer when audioList has items', () => {
    render(
      <MessageContent
        audioList={[{ alt: 'audio.mp3', id: 'a1', url: 'https://example.com/a.mp3' }]}
        content={''}
        createdAt={Date.now()}
        id={'msg-3'}
        role={'user'}
        updatedAt={Date.now()}
      />,
    );

    expect(screen.getByTestId('audio-viewer')).toHaveTextContent('1');
  });

  it('should render code context selections in the user message body', () => {
    render(
      <MessageContent
        content={'What does this selected code do?'}
        createdAt={Date.now()}
        id={'msg-4'}
        role={'user'}
        updatedAt={Date.now()}
        metadata={{
          contextSelections: [
            {
              content: 'const answer = 42;',
              filePath: 'src/example.ts',
              id: 'selection-1',
              lineRange: { endLine: 7, startLine: 7 },
              source: 'code',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('src/example.ts:7-7')).toBeInTheDocument();
    expect(screen.getByText('const answer = 42;')).toBeInTheDocument();
    expect(screen.getByText('What does this selected code do?')).toBeInTheDocument();
  });
});

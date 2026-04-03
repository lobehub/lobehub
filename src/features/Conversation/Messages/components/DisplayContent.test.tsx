import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DisplayContent from './DisplayContent';

vi.mock('@/features/Conversation/Markdown', () => ({
  default: ({ children }: any) => (
    <div data-content={children} data-testid="markdown-message">
      {children}
    </div>
  ),
}));

vi.mock('./ContentLoading', () => ({
  default: ({ id }: { id: string }) => <div data-testid="content-loading">{id}</div>,
}));

vi.mock('./RichContentRenderer', () => ({
  RichContentRenderer: () => <div data-testid="rich-content" />,
}));

describe('DisplayContent', () => {
  it('should keep literal think tags in markdown content unchanged', () => {
    const content = '<think>Reasoning example</think>\n\nFinal answer';

    render(<DisplayContent content={content} id={'msg-1'} />);

    expect(screen.getByTestId('markdown-message')).toHaveAttribute('data-content', content);
  });
});

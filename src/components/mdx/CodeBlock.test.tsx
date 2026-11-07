import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CodeBlock from './CodeBlock';

vi.mock('@lobehub/ui', () => ({
  Mermaid: ({ children, variant }: any) => (
    <div data-testid="mermaid" data-variant={variant}>
      {children}
    </div>
  ),
}));

vi.mock('@lobehub/ui/mdx', () => ({
  Pre: ({ children, language }: any) => (
    <pre data-testid="pre" data-lang={language}>
      {children}
    </pre>
  ),
  PreSingleLine: ({ children, language }: any) => (
    <span data-testid="pre-single" data-lang={language}>
      {children}
    </span>
  ),
}));

describe('CodeBlock', () => {
  it('should render PreSingleLine for single line short code', () => {
    const raw = {
      props: {
        children: 'hello',
        className: 'language-js',
      },
    };

    render(<CodeBlock>{raw}</CodeBlock>);

    const el = screen.getByTestId('pre-single');
    expect(el).toBeDefined();
    expect(el.textContent).toBe('hello');
    expect(el.getAttribute('data-lang')).toBe('js');
  });

  it('should render Mermaid component for language-mermaid', () => {
    const raw = {
      props: {
        children: 'flowchart TD\n  A --> B\n  C --> D\n  E --> F\n  G --> H',
        className: 'language-mermaid',
      },
    };

    render(<CodeBlock>{raw}</CodeBlock>);

    const el = screen.getByTestId('mermaid');
    expect(el).toBeDefined();
    expect(el.textContent).toBe('flowchart TD\n  A --> B\n  C --> D\n  E --> F\n  G --> H');
  });

  it('should render Pre component for standard multi-line code', () => {
    const raw = {
      props: {
        children: 'const x = 1;\nconst y = 2;\nconst z = 3;\nconst w = 4;',
        className: 'language-js',
      },
    };

    render(<CodeBlock>{raw}</CodeBlock>);

    const el = screen.getByTestId('pre');
    expect(el).toBeDefined();
    expect(el.textContent).toBe('const x = 1;\nconst y = 2;\nconst z = 3;\nconst w = 4;');
    expect(el.getAttribute('data-lang')).toBe('js');
  });

  it('should extract text recursively and convert br tag elements to <br> string', () => {
    // Mimic the children array with mixed text and <br> elements parsed by rehype-raw
    const brNode = { type: 'br', props: {} };
    const raw = {
      props: {
        children: ['flowchart LR\n  A["text', brNode, 'line2"] --> B["some long connection description"]'],
        className: 'language-mermaid',
      },
    };

    render(<CodeBlock>{raw}</CodeBlock>);

    const el = screen.getByTestId('mermaid');
    expect(el).toBeDefined();
    expect(el.textContent).toBe('flowchart LR\n  A["text<br>line2"] --> B["some long connection description"]');
  });
});

/**
 * @vitest-environment happy-dom
 */
import { moment } from '@lobehub/editor';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import RichTextMessage from './RichTextMessage';

const mentionEditorState = {
  root: {
    children: [
      {
        children: [
          {
            label: 'Agent A',
            metadata: { id: 'agent-a', type: 'agent' },
            type: 'mention',
            version: 1,
          },
        ],
        direction: null,
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
};

const localFileEditorState = {
  root: {
    children: [
      {
        children: [
          {
            isDirectory: false,
            name: 'report.md',
            path: '/Users/me/project/report.md',
            type: 'local-file-tag',
            version: 1,
          },
        ],
        direction: null,
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
};

const blockImageEditorState = {
  root: {
    children: [
      {
        altText: 'usage chart',
        height: 'inherit',
        maxWidth: 904,
        src: 'https://example.com/chart.png',
        type: 'block-image',
        version: 1,
        width: 'inherit',
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
};

afterEach(() => {
  cleanup();
});

describe('RichTextMessage', () => {
  it('should allow document comments to use the default 16px renderer scale', async () => {
    const { container } = render(
      <RichTextMessage editorState={mentionEditorState} variant={'default'} />,
    );

    await act(async () => {
      await moment();
    });

    expect(
      (container.firstElementChild as HTMLElement).style.getPropertyValue('--common-font-size'),
    ).toBe('16px');
  });

  it('should render mention nodes from editor state', async () => {
    const { container } = render(<RichTextMessage editorState={mentionEditorState} />);

    await act(async () => {
      await moment();
    });

    expect(container.querySelector('.editor_mention')?.textContent).toBe('@Agent A');
  });

  // Regression: a local file dragged from the working sidebar serializes to a
  // `local-file-tag` node. If that node isn't registered on the renderer,
  // LexicalRenderer throws while parsing the state and the whole message crashes.
  it('should render local-file-tag nodes without crashing', async () => {
    const { container } = render(<RichTextMessage editorState={localFileEditorState} />);

    await act(async () => {
      await moment();
    });

    expect(container.textContent).toContain('report.md');
  });

  // Regression (LOBE-14115): the renderer's stock image node is a bare <img>,
  // so an image inside a published comment could not be enlarged.
  it('should open the image viewer when a rendered image is clicked', async () => {
    const { container } = render(
      <RichTextMessage editorState={blockImageEditorState} variant={'default'} />,
    );

    await act(async () => {
      await moment();
    });

    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', 'https://example.com/chart.png');
    expect(container.querySelector('figure')).not.toBeNull();

    await act(async () => {
      fireEvent.pointerDown(image!);
      fireEvent.click(image!);
    });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('should render nothing for empty editor state', () => {
    const { container } = render(<RichTextMessage editorState={{}} />);

    expect(container).toBeEmptyDOMElement();
  });
});

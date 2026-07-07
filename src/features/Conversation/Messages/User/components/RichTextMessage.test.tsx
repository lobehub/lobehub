/**
 * @vitest-environment happy-dom
 */
import { moment } from '@lobehub/editor';
import { act, cleanup, render } from '@testing-library/react';
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

afterEach(() => {
  cleanup();
});

describe('RichTextMessage', () => {
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

  it('should render nothing for empty editor state', () => {
    const { container } = render(<RichTextMessage editorState={{}} />);

    expect(container).toBeEmptyDOMElement();
  });
});

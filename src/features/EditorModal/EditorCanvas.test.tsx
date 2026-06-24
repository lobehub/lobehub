/**
 * @vitest-environment happy-dom
 */
import { type IEditor } from '@lobehub/editor';
import { moment } from '@lobehub/editor';
import { useEditor } from '@lobehub/editor/react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { memo, useEffect, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import EditorCanvas from './EditorCanvas';

const typoBarMock = vi.hoisted(() => vi.fn(() => null));

vi.mock('./Typobar', () => ({
  default: typoBarMock,
}));

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

interface TestWrapperProps {
  defaultValue?: string;
  editorData?: unknown;
  onEditorReady?: (editor: IEditor) => void;
  tooltipPopupContainer?: HTMLElement | null;
}

const TestWrapper = memo<TestWrapperProps>(
  ({ defaultValue, editorData, onEditorReady, tooltipPopupContainer }) => {
    const editor = useEditor();
    const readyRef = useRef(false);

    useEffect(() => {
      if (editor && !readyRef.current) {
        readyRef.current = true;
        onEditorReady?.(editor);
      }
    }, [editor, onEditorReady]);

    if (!editor) return null;

    return (
      <EditorCanvas
        defaultValue={defaultValue}
        editor={editor}
        editorData={editorData}
        tooltipPopupContainer={tooltipPopupContainer}
      />
    );
  },
);

TestWrapper.displayName = 'EditorModalEditorCanvasTestWrapper';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EditorModal EditorCanvas', () => {
  it('should render mention nodes from editor data', async () => {
    const { container } = render(<TestWrapper editorData={mentionEditorState} />);

    await act(async () => {
      await moment();
    });

    expect(container.querySelector('.editor_mention')?.textContent).toBe('@Agent A');
  });

  it('should render markdown default value when editor data is missing', async () => {
    render(<TestWrapper defaultValue={'Hello from markdown'} />);

    await act(async () => {
      await moment();
    });

    expect(screen.getByText('Hello from markdown')).toBeInTheDocument();
  });

  it('should forward tooltip popup container to TypoBar', () => {
    const popupContainer = document.createElement('div');

    render(<TestWrapper defaultValue={'tooltip test'} tooltipPopupContainer={popupContainer} />);

    expect(typoBarMock).toHaveBeenCalled();
    expect(typoBarMock.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ popupContainer }));
  });
});

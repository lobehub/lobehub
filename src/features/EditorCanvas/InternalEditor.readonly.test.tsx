/**
 * @vitest-environment happy-dom
 */
import { type IEditor } from '@lobehub/editor';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import InternalEditor from './InternalEditor';

const editorProps = vi.hoisted(() => ({
  last: undefined as any,
}));

vi.mock('@lobehub/editor/react', () => ({
  Editor: Object.assign(
    vi.fn((props: any) => {
      editorProps.last = props;
      return <div data-testid="editor" />;
    }),
    { withProps: (plugin: unknown) => plugin },
  ),
  useEditorState: () => ({}),
}));

vi.mock('@lobehub/editor', () => ({
  ReactImagePlugin: vi.fn(),
  ReactLinkPlugin: vi.fn(),
  ReactLiteXmlPlugin: vi.fn(),
  ReactTablePlugin: vi.fn(),
  ReactToolbarPlugin: vi.fn(),
}));

vi.mock('@/features/ChatInput/InputEditor/plugins', () => ({
  createChatInputRichPlugins: () => [],
}));

vi.mock('./InlineToolbar', () => ({
  default: () => <div />,
}));

vi.mock('./useImageUpload', () => ({
  useFileUpload: () => vi.fn(),
  useImageUpload: () => vi.fn(),
}));

vi.mock('@lobechat/const', () => ({
  isDesktop: false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('InternalEditor readonly state', () => {
  const editor = {
    getDocument: vi.fn(),
    getLexicalEditor: vi.fn(() => undefined),
    setDocument: vi.fn(),
  } as unknown as IEditor;

  beforeEach(() => {
    editorProps.last = undefined;
  });

  it('passes editable=false to the editor when disabled', () => {
    render(<InternalEditor disabled editor={editor} />);

    expect(editorProps.last?.editable).toBe(false);
  });
});

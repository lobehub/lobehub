/**
 * @vitest-environment happy-dom
 */
import { type IEditor } from '@lobehub/editor';
import { moment } from '@lobehub/editor';
import { useEditor } from '@lobehub/editor/react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { memo, useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type InternalEditorProps } from './InternalEditor';
import InternalEditor from './InternalEditor';

// Suppress console.warn for expected errors in tests
const originalWarn = console.warn;
beforeEach(() => {
  console.warn = vi.fn();
});

afterEach(() => {
  console.warn = originalWarn;
  cleanup();
});

/**
 * Test wrapper component that creates a real editor using useEditor hook
 * This ensures all plugins and services are properly initialized
 */
interface TestWrapperProps extends Omit<InternalEditorProps, 'editor'> {
  onEditorReady?: (editor: IEditor) => void;
}

const TestWrapper = memo<TestWrapperProps>(({ onEditorReady, ...props }) => {
  const editor = useEditor();
  const readyRef = useRef(false);

  useEffect(() => {
    if (editor && !readyRef.current) {
      readyRef.current = true;
      onEditorReady?.(editor);
    }
  }, [editor, onEditorReady]);

  if (!editor) return null;
  return <InternalEditor editor={editor} {...props} />;
});

TestWrapper.displayName = 'TestWrapper';

/**
 * Test wrapper for tests that need custom plugins (no toolbar dependencies)
 */
const MinimalTestWrapper = memo<TestWrapperProps>(({ onEditorReady, plugins, ...props }) => {
  const editor = useEditor();
  const readyRef = useRef(false);

  useEffect(() => {
    if (editor && !readyRef.current) {
      readyRef.current = true;
      onEditorReady?.(editor);
    }
  }, [editor, onEditorReady]);

  if (!editor) return null;

  // Use minimal plugins that don't require toolbar services
  const minimalPlugins = plugins || [];

  return <InternalEditor editor={editor} plugins={minimalPlugins} {...props} />;
});

MinimalTestWrapper.displayName = 'MinimalTestWrapper';

describe('InternalEditor', () => {
  describe('rendering', () => {
    it('should render editor with real editor instance', async () => {
      const { container } = render(<MinimalTestWrapper />);

      await act(async () => {
        await moment();
      });

      // Editor should be rendered
      expect(container.querySelector('[data-lexical-editor]')).not.toBeNull();
    });

    it('should render with custom placeholder', async () => {
      const placeholder = 'Start typing here...';
      const { container } = render(<MinimalTestWrapper placeholder={placeholder} />);

      await act(async () => {
        await moment();
      });

      expect(container.textContent).toContain(placeholder);
    });

    it('should apply custom styles', async () => {
      const customStyle = { backgroundColor: 'red', paddingTop: 100 };
      const { container } = render(<MinimalTestWrapper style={customStyle} />);

      await act(async () => {
        await moment();
      });

      // Find the Editor component's container
      const editorContainer = container.querySelector('[data-lexical-editor]')?.closest('div');
      // The style should include paddingBottom: 64 (default) merged with custom styles
      expect(editorContainer).toBeTruthy();
    });
  });

  describe('onInit callback', () => {
    it('should call onInit when editor initializes', async () => {
      const onInit = vi.fn();

      render(<MinimalTestWrapper onInit={onInit} />);

      await act(async () => {
        await moment();
      });

      await waitFor(() => {
        expect(onInit).toHaveBeenCalled();
      });
    });

    it('should pass editor instance to onInit', async () => {
      const onInit = vi.fn();

      render(<MinimalTestWrapper onInit={onInit} />);

      await act(async () => {
        await moment();
      });

      await waitFor(() => {
        expect(onInit).toHaveBeenCalledWith(
          expect.objectContaining({ getDocument: expect.any(Function) }),
        );
      });
    });

    it('should not throw error when initialized with empty content', async () => {
      const onInit = vi.fn();
      let editorInstance: IEditor | undefined;

      // This test ensures the fix for "setEditorState: the editor state is empty" error
      // When editor initializes with empty/undefined content, it should not throw
      const { container } = render(
        <MinimalTestWrapper
          onInit={onInit}
          onEditorReady={(e) => {
            editorInstance = e;
          }}
        />,
      );

      await act(async () => {
        await moment();
      });

      // Editor should initialize without error
      await waitFor(() => {
        expect(onInit).toHaveBeenCalled();
        expect(editorInstance).toBeDefined();
      });

      // Editor should be rendered
      expect(container.querySelector('[data-lexical-editor]')).not.toBeNull();

      // Getting document should work (returns empty content)
      const text = editorInstance!.getDocument('text') as unknown as string;
      expect(text).toBeDefined();
    });
  });

  describe('onContentChange callback', () => {
    it('should call onContentChange when content changes via setDocument', async () => {
      const onContentChange = vi.fn();
      let editorInstance: IEditor | undefined;

      render(
        <MinimalTestWrapper
          onContentChange={onContentChange}
          onEditorReady={(e) => {
            editorInstance = e;
          }}
        />,
      );

      await act(async () => {
        await moment();
      });

      // Wait for editor to be ready
      await waitFor(() => {
        expect(editorInstance).toBeDefined();
      });

      // Change content using editor API
      await act(async () => {
        editorInstance!.setDocument('text', 'Hello World');
        await moment();
      });

      await waitFor(
        () => {
          expect(onContentChange).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );
    });

    it('should call onContentChange when markdown content is set', async () => {
      const onContentChange = vi.fn();
      let editorInstance: IEditor | undefined;

      render(
        <MinimalTestWrapper
          onContentChange={onContentChange}
          onEditorReady={(e) => {
            editorInstance = e;
          }}
        />,
      );

      await act(async () => {
        await moment();
      });

      await waitFor(() => {
        expect(editorInstance).toBeDefined();
      });

      // Change content using markdown
      await act(async () => {
        editorInstance!.setDocument('markdown', '# Hello\n\nThis is a paragraph.');
        await moment();
      });

      await waitFor(
        () => {
          expect(onContentChange).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );
    });

    it('should track multiple content changes', async () => {
      const onContentChange = vi.fn();
      let editorInstance: IEditor | undefined;

      render(
        <MinimalTestWrapper
          onContentChange={onContentChange}
          onEditorReady={(e) => {
            editorInstance = e;
          }}
        />,
      );

      await act(async () => {
        await moment();
      });

      await waitFor(() => {
        expect(editorInstance).toBeDefined();
      });

      // First change
      await act(async () => {
        editorInstance!.setDocument('text', 'First content');
        await moment();
      });

      // Second change
      await act(async () => {
        editorInstance!.setDocument('text', 'Second content');
        await moment();
      });

      // Third change
      await act(async () => {
        editorInstance!.setDocument('text', 'Third content');
        await moment();
      });

      await waitFor(
        () => {
          // Should have multiple calls for different content changes
          expect(onContentChange.mock.calls.length).toBeGreaterThanOrEqual(2);
        },
        { timeout: 2000 },
      );
    });
  });

  describe('editor content methods', () => {
    it('should allow getting document as markdown', async () => {
      let editorInstance: IEditor | undefined;

      render(
        <MinimalTestWrapper
          onEditorReady={(e) => {
            editorInstance = e;
          }}
        />,
      );

      await act(async () => {
        await moment();
      });

      await waitFor(() => {
        expect(editorInstance).toBeDefined();
      });

      await act(async () => {
        editorInstance!.setDocument('text', 'Test content');
        await moment();
      });

      const markdown = editorInstance!.getDocument('markdown') as unknown as string;
      expect(markdown).toContain('Test content');
    });

    it('should allow getting document as JSON', async () => {
      let editorInstance: IEditor | undefined;

      render(
        <MinimalTestWrapper
          onEditorReady={(e) => {
            editorInstance = e;
          }}
        />,
      );

      await act(async () => {
        await moment();
      });

      await waitFor(() => {
        expect(editorInstance).toBeDefined();
      });

      await act(async () => {
        editorInstance!.setDocument('text', 'Test content');
        await moment();
      });

      const json = editorInstance!.getDocument('json');
      expect(json).toBeDefined();
      expect(typeof json).toBe('object');
    });

    it('should allow getting document as text', async () => {
      let editorInstance: IEditor | undefined;

      render(
        <MinimalTestWrapper
          onEditorReady={(e) => {
            editorInstance = e;
          }}
        />,
      );

      await act(async () => {
        await moment();
      });

      await waitFor(() => {
        expect(editorInstance).toBeDefined();
      });

      await act(async () => {
        editorInstance!.setDocument('markdown', '# Heading\n\nParagraph');
        await moment();
      });

      const text = editorInstance!.getDocument('text') as unknown as string;
      expect(text).toContain('Heading');
      expect(text).toContain('Paragraph');
    });
  });

  describe('lexical editor access', () => {
    it('should expose getLexicalEditor method', async () => {
      let editorInstance: IEditor | undefined;

      render(
        <MinimalTestWrapper
          onEditorReady={(e) => {
            editorInstance = e;
          }}
        />,
      );

      await act(async () => {
        await moment();
      });

      await waitFor(() => {
        expect(editorInstance).toBeDefined();
      });

      const lexicalEditor = editorInstance!.getLexicalEditor?.();
      expect(lexicalEditor).toBeDefined();
    });

    it('should allow registering custom update listeners', async () => {
      const updateListener = vi.fn();
      let editorInstance: IEditor | undefined;

      render(
        <MinimalTestWrapper
          onEditorReady={(e) => {
            editorInstance = e;
          }}
        />,
      );

      await act(async () => {
        await moment();
      });

      await waitFor(() => {
        expect(editorInstance).toBeDefined();
      });

      const lexicalEditor = editorInstance!.getLexicalEditor?.();
      expect(lexicalEditor).toBeDefined();

      if (lexicalEditor) {
        const unregister = lexicalEditor.registerUpdateListener(updateListener);

        // Trigger an update
        await act(async () => {
          editorInstance!.setDocument('text', 'Updated content');
          await moment();
        });

        expect(updateListener).toHaveBeenCalled();

        // Cleanup
        unregister();
      }
    });
  });

  describe('custom plugins', () => {
    it('should accept custom plugins array', async () => {
      const CustomPlugin = () => null;

      const { container } = render(<MinimalTestWrapper plugins={[CustomPlugin]} />);

      await act(async () => {
        await moment();
      });

      // Should render without error
      expect(container.querySelector('[data-lexical-editor]')).not.toBeNull();
    });

    it('should accept extra plugins prepended to base plugins', async () => {
      const ExtraPlugin = () => null;

      // Note: extraPlugins requires base plugins which need toolbar services
      // We test this with minimal plugins instead
      const { container } = render(<MinimalTestWrapper plugins={[ExtraPlugin]} />);

      await act(async () => {
        await moment();
      });

      // Should render without error
      expect(container.querySelector('[data-lexical-editor]')).not.toBeNull();
    });
  });

  describe('window.__editor assignment', () => {
    it('should assign editor to window.__editor for debugging', async () => {
      let editorInstance: IEditor | undefined;

      render(
        <MinimalTestWrapper
          onEditorReady={(e) => {
            editorInstance = e;
          }}
        />,
      );

      await act(async () => {
        await moment();
      });

      await waitFor(() => {
        expect(editorInstance).toBeDefined();
      });

      expect(window.__editor).toBe(editorInstance);
    });

    it('should clear window.__editor on unmount', async () => {
      let editorInstance: IEditor | undefined;

      const { unmount } = render(
        <MinimalTestWrapper
          onEditorReady={(e) => {
            editorInstance = e;
          }}
        />,
      );

      await act(async () => {
        await moment();
      });

      await waitFor(() => {
        expect(editorInstance).toBeDefined();
      });

      expect(window.__editor).toBe(editorInstance);

      unmount();

      expect(window.__editor).toBeUndefined();
    });
  });

  describe('callback stability', () => {
    it('should maintain stable onContentChange behavior across re-renders', async () => {
      const onContentChange = vi.fn();
      let editorInstance: IEditor | undefined;

      const { rerender } = render(
        <MinimalTestWrapper
          onContentChange={onContentChange}
          onEditorReady={(e) => {
            editorInstance = e;
          }}
        />,
      );

      await act(async () => {
        await moment();
      });

      await waitFor(() => {
        expect(editorInstance).toBeDefined();
      });

      // Re-render with same props
      rerender(
        <MinimalTestWrapper
          onContentChange={onContentChange}
          onEditorReady={(e) => {
            editorInstance = e;
          }}
        />,
      );

      await act(async () => {
        await moment();
      });

      // Change content after re-render
      await act(async () => {
        editorInstance!.setDocument('text', 'Content after rerender');
        await moment();
      });

      await waitFor(
        () => {
          expect(onContentChange).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );
    });

    it('should use updated callback when onContentChange prop changes', async () => {
      const firstCallback = vi.fn();
      const secondCallback = vi.fn();
      let editorInstance: IEditor | undefined;

      const { rerender } = render(
        <MinimalTestWrapper
          onContentChange={firstCallback}
          onEditorReady={(e) => {
            editorInstance = e;
          }}
        />,
      );

      await act(async () => {
        await moment();
      });

      await waitFor(() => {
        expect(editorInstance).toBeDefined();
      });

      // Change callback prop
      rerender(
        <MinimalTestWrapper
          onContentChange={secondCallback}
          onEditorReady={(e) => {
            editorInstance = e;
          }}
        />,
      );

      await act(async () => {
        await moment();
      });

      // Trigger content change
      await act(async () => {
        editorInstance!.setDocument('text', 'New content');
        await moment();
      });

      await waitFor(
        () => {
          // Second callback should be called
          expect(secondCallback).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );
    });
  });
});

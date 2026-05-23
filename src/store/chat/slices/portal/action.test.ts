import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import { PortalViewType } from './initialState';

vi.mock('zustand/traditional');

describe('chatDockSlice', () => {
  describe('pushPortalView', () => {
    it('should push a new view onto the stack and open portal', () => {
      const { result } = renderHook(() => useChatStore());

      expect(result.current.portalStack).toEqual([]);
      expect(result.current.showPortal).toBe(false);

      act(() => {
        result.current.pushPortalView({ type: PortalViewType.Notebook });
      });

      expect(result.current.portalStack).toHaveLength(1);
      expect(result.current.portalStack[0]).toEqual({ type: PortalViewType.Notebook });
      expect(result.current.showPortal).toBe(true);
    });

    it('should replace top view when pushing same type', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.pushPortalView({ type: PortalViewType.Document, documentId: 'doc-1' });
      });

      expect(result.current.portalStack).toHaveLength(1);

      act(() => {
        result.current.pushPortalView({ type: PortalViewType.Document, documentId: 'doc-2' });
      });

      expect(result.current.portalStack).toHaveLength(1);
      expect(result.current.portalStack[0]).toEqual({
        type: PortalViewType.Document,
        documentId: 'doc-2',
      });
    });

    it('should stack different view types', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.pushPortalView({ type: PortalViewType.Notebook });
      });

      act(() => {
        result.current.pushPortalView({ type: PortalViewType.Document, documentId: 'doc-1' });
      });

      expect(result.current.portalStack).toHaveLength(2);
      expect(result.current.portalStack[0]).toEqual({ type: PortalViewType.Notebook });
      expect(result.current.portalStack[1]).toEqual({
        type: PortalViewType.Document,
        documentId: 'doc-1',
      });
    });
  });

  describe('popPortalView', () => {
    it('should pop the top view and close portal when stack is empty', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.pushPortalView({ type: PortalViewType.Notebook });
      });

      expect(result.current.showPortal).toBe(true);

      act(() => {
        result.current.popPortalView();
      });

      expect(result.current.portalStack).toHaveLength(0);
      expect(result.current.showPortal).toBe(false);
    });

    it('should pop top view and keep portal open when more views exist', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.pushPortalView({ type: PortalViewType.Notebook });
      });

      act(() => {
        result.current.pushPortalView({ type: PortalViewType.Document, documentId: 'doc-1' });
      });

      expect(result.current.portalStack).toHaveLength(2);

      act(() => {
        result.current.popPortalView();
      });

      expect(result.current.portalStack).toHaveLength(1);
      expect(result.current.portalStack[0]).toEqual({ type: PortalViewType.Notebook });
      expect(result.current.showPortal).toBe(true);
    });
  });

  describe('replacePortalView', () => {
    it('should replace top view with new view', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.pushPortalView({ type: PortalViewType.Notebook });
      });

      act(() => {
        result.current.replacePortalView({ type: PortalViewType.Document, documentId: 'doc-1' });
      });

      expect(result.current.portalStack).toHaveLength(1);
      expect(result.current.portalStack[0]).toEqual({
        type: PortalViewType.Document,
        documentId: 'doc-1',
      });
    });

    it('should push view when stack is empty', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.replacePortalView({ type: PortalViewType.Notebook });
      });

      expect(result.current.portalStack).toHaveLength(1);
      expect(result.current.portalStack[0]).toEqual({ type: PortalViewType.Notebook });
      expect(result.current.showPortal).toBe(true);
    });
  });

  describe('clearPortalStack', () => {
    it('should clear all views and close portal', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.pushPortalView({ type: PortalViewType.Notebook });
      });

      act(() => {
        result.current.pushPortalView({ type: PortalViewType.Document, documentId: 'doc-1' });
      });

      expect(result.current.portalStack).toHaveLength(2);

      act(() => {
        result.current.clearPortalStack();
      });

      expect(result.current.portalStack).toHaveLength(0);
      expect(result.current.showPortal).toBe(false);
    });
  });

  describe('goBack', () => {
    it('should pop top view when stack has multiple views', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.pushPortalView({ type: PortalViewType.Notebook });
      });

      act(() => {
        result.current.pushPortalView({ type: PortalViewType.Document, documentId: 'doc-1' });
      });

      act(() => {
        result.current.goBack();
      });

      expect(result.current.portalStack).toHaveLength(1);
      expect(result.current.portalStack[0]).toEqual({ type: PortalViewType.Notebook });
    });
  });

  describe('goHome', () => {
    it('should replace stack with home view', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.pushPortalView({ type: PortalViewType.Notebook });
      });

      act(() => {
        result.current.pushPortalView({ type: PortalViewType.Document, documentId: 'doc-1' });
      });

      act(() => {
        result.current.goHome();
      });

      expect(result.current.portalStack).toHaveLength(1);
      expect(result.current.portalStack[0]).toEqual({ type: PortalViewType.Home });
      expect(result.current.showPortal).toBe(true);
    });
  });

  describe('closeToolUI', () => {
    it('should pop ToolUI view from stack', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openToolUI('test-id', 'test-identifier');
      });

      expect(result.current.portalStack).toHaveLength(1);
      expect(result.current.portalStack[0]).toEqual({
        type: PortalViewType.ToolUI,
        messageId: 'test-id',
        identifier: 'test-identifier',
      });

      act(() => {
        result.current.closeToolUI();
      });

      expect(result.current.portalStack).toHaveLength(0);
      expect(result.current.showPortal).toBe(false);
    });
  });

  describe('openArtifact', () => {
    it('should push Artifact view and open portal', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openArtifact({
          id: 'msg-1',
          identifier: 'artifact-1',
          title: 'First Artifact',
          type: 'text/markdown',
        });
      });

      expect(result.current.portalStack).toHaveLength(1);
      expect(result.current.portalStack[0]).toEqual({
        type: PortalViewType.Artifact,
        artifact: {
          id: 'msg-1',
          identifier: 'artifact-1',
          title: 'First Artifact',
          type: 'text/markdown',
        },
      });
      expect(result.current.showPortal).toBe(true);
    });

    it('should replace artifact view when switching to different artifact from same message', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openArtifact({
          id: 'msg-1',
          identifier: 'artifact-1',
          title: 'First Artifact',
          type: 'text/markdown',
        });
      });

      act(() => {
        result.current.openArtifact({
          id: 'msg-1',
          identifier: 'artifact-2',
          title: 'Second Artifact',
          type: 'text/html',
        });
      });

      // Should replace, not stack (same view type)
      expect(result.current.portalStack).toHaveLength(1);
      expect(result.current.portalStack[0]).toEqual({
        type: PortalViewType.Artifact,
        artifact: {
          id: 'msg-1',
          identifier: 'artifact-2',
          title: 'Second Artifact',
          type: 'text/html',
        },
      });
    });

    it('should replace artifact view when switching to artifact from different message', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openArtifact({
          id: 'msg-1',
          identifier: 'artifact-1',
          title: 'First',
          type: 'text/markdown',
        });
      });

      act(() => {
        result.current.openArtifact({
          id: 'msg-2',
          identifier: 'artifact-x',
          title: 'Other',
          type: 'text/html',
        });
      });

      expect(result.current.portalStack).toHaveLength(1);
      expect(result.current.portalStack[0]).toEqual({
        type: PortalViewType.Artifact,
        artifact: {
          id: 'msg-2',
          identifier: 'artifact-x',
          title: 'Other',
          type: 'text/html',
        },
      });
    });
  });

  describe('openLocalFile', () => {
    it('should add entry to openLocalFiles, set active, and push LocalFile view', () => {
      const { result } = renderHook(() => useChatStore());

      expect(result.current.showPortal).toBe(false);

      act(() => {
        result.current.openLocalFile({
          filePath: '/path/to/file.ts',
          workingDirectory: '/path/to',
        });
      });

      expect(result.current.openLocalFiles).toEqual([
        { filePath: '/path/to/file.ts', workingDirectory: '/path/to' },
      ]);
      expect(result.current.activeLocalFilePath).toBe('/path/to/file.ts');
      expect(result.current.portalStack).toHaveLength(1);
      expect(result.current.portalStack[0]).toEqual({ type: PortalViewType.LocalFile });
      expect(result.current.showPortal).toBe(true);
    });

    it('should not duplicate entry when opening same filePath twice', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openLocalFile({ filePath: '/path/a.ts', workingDirectory: '/path' });
      });

      act(() => {
        result.current.openLocalFile({ filePath: '/path/a.ts', workingDirectory: '/path' });
      });

      expect(result.current.openLocalFiles).toHaveLength(1);
      expect(result.current.activeLocalFilePath).toBe('/path/a.ts');
    });

    it('should add multiple files as separate tabs and keep portal as single entry', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openLocalFile({ filePath: '/path/a.ts', workingDirectory: '/path' });
      });

      act(() => {
        result.current.openLocalFile({ filePath: '/path/b.ts', workingDirectory: '/path' });
      });

      expect(result.current.openLocalFiles).toHaveLength(2);
      expect(result.current.activeLocalFilePath).toBe('/path/b.ts');
      // pushPortalView replaces same type, so stack stays length 1
      expect(result.current.portalStack).toHaveLength(1);
      expect(result.current.portalStack[0]).toEqual({ type: PortalViewType.LocalFile });
    });
  });

  describe('closeLocalFile', () => {
    it('should pop LocalFile view from stack', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openLocalFile({
          filePath: '/path/to/file.ts',
          workingDirectory: '/path/to',
        });
      });

      expect(result.current.portalStack).toHaveLength(1);

      act(() => {
        result.current.closeLocalFile();
      });

      expect(result.current.portalStack).toHaveLength(0);
      expect(result.current.showPortal).toBe(false);
    });

    it('should not pop when LocalFile is not the top view', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openLocalFile({
          filePath: '/path/to/file.ts',
          workingDirectory: '/path/to',
        });
      });

      act(() => {
        result.current.pushPortalView({ type: PortalViewType.Document, documentId: 'doc-1' });
      });

      expect(result.current.portalStack).toHaveLength(2);

      act(() => {
        result.current.closeLocalFile();
      });

      // Document is on top, LocalFile should not be popped
      expect(result.current.portalStack).toHaveLength(2);
    });
  });

  describe('closeLocalFileTab', () => {
    it('should remove the entry from openLocalFiles', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openLocalFile({ filePath: '/path/a.ts', workingDirectory: '/path' });
        result.current.openLocalFile({ filePath: '/path/b.ts', workingDirectory: '/path' });
      });

      act(() => {
        result.current.closeLocalFileTab('/path/a.ts');
      });

      expect(result.current.openLocalFiles).toHaveLength(1);
      expect(result.current.openLocalFiles[0].filePath).toBe('/path/b.ts');
    });

    it('should set active to right neighbor when closing active tab', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openLocalFile({ filePath: '/path/a.ts', workingDirectory: '/path' });
        result.current.openLocalFile({ filePath: '/path/b.ts', workingDirectory: '/path' });
        result.current.openLocalFile({ filePath: '/path/c.ts', workingDirectory: '/path' });
      });

      // Set active to first tab
      act(() => {
        result.current.setActiveLocalFile('/path/a.ts');
      });

      act(() => {
        result.current.closeLocalFileTab('/path/a.ts');
      });

      // After removing index 0, index 0 is now b.ts
      expect(result.current.activeLocalFilePath).toBe('/path/b.ts');
    });

    it('should set active to left neighbor when closing last tab', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openLocalFile({ filePath: '/path/a.ts', workingDirectory: '/path' });
        result.current.openLocalFile({ filePath: '/path/b.ts', workingDirectory: '/path' });
      });

      // active is b.ts (last opened)
      act(() => {
        result.current.closeLocalFileTab('/path/b.ts');
      });

      expect(result.current.activeLocalFilePath).toBe('/path/a.ts');
    });

    it('should pop portal view when last tab is closed', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openLocalFile({ filePath: '/path/a.ts', workingDirectory: '/path' });
      });

      act(() => {
        result.current.closeLocalFileTab('/path/a.ts');
      });

      expect(result.current.openLocalFiles).toHaveLength(0);
      expect(result.current.showPortal).toBe(false);
    });

    it('should do nothing when filePath not in openLocalFiles', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openLocalFile({ filePath: '/path/a.ts', workingDirectory: '/path' });
      });

      act(() => {
        result.current.closeLocalFileTab('/path/nonexistent.ts');
      });

      expect(result.current.openLocalFiles).toHaveLength(1);
    });
  });

  describe('closeLeftLocalFileTabs', () => {
    it('should close tabs to the left and keep active when active remains open', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openLocalFile({ filePath: '/path/a.ts', workingDirectory: '/path' });
        result.current.openLocalFile({ filePath: '/path/b.ts', workingDirectory: '/path' });
        result.current.openLocalFile({ filePath: '/path/c.ts', workingDirectory: '/path' });
      });

      act(() => {
        result.current.closeLeftLocalFileTabs('/path/b.ts');
      });

      expect(result.current.openLocalFiles.map((f) => f.filePath)).toEqual([
        '/path/b.ts',
        '/path/c.ts',
      ]);
      expect(result.current.activeLocalFilePath).toBe('/path/c.ts');
    });

    it('should activate target tab when closing the active tab on the left', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openLocalFile({ filePath: '/path/a.ts', workingDirectory: '/path' });
        result.current.openLocalFile({ filePath: '/path/b.ts', workingDirectory: '/path' });
        result.current.openLocalFile({ filePath: '/path/c.ts', workingDirectory: '/path' });
        result.current.setActiveLocalFile('/path/a.ts');
      });

      act(() => {
        result.current.closeLeftLocalFileTabs('/path/c.ts');
      });

      expect(result.current.openLocalFiles.map((f) => f.filePath)).toEqual(['/path/c.ts']);
      expect(result.current.activeLocalFilePath).toBe('/path/c.ts');
    });
  });

  describe('closeRightLocalFileTabs', () => {
    it('should close tabs to the right and keep active when active remains open', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openLocalFile({ filePath: '/path/a.ts', workingDirectory: '/path' });
        result.current.openLocalFile({ filePath: '/path/b.ts', workingDirectory: '/path' });
        result.current.openLocalFile({ filePath: '/path/c.ts', workingDirectory: '/path' });
        result.current.setActiveLocalFile('/path/a.ts');
      });

      act(() => {
        result.current.closeRightLocalFileTabs('/path/b.ts');
      });

      expect(result.current.openLocalFiles.map((f) => f.filePath)).toEqual([
        '/path/a.ts',
        '/path/b.ts',
      ]);
      expect(result.current.activeLocalFilePath).toBe('/path/a.ts');
    });

    it('should activate target tab when closing the active tab on the right', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openLocalFile({ filePath: '/path/a.ts', workingDirectory: '/path' });
        result.current.openLocalFile({ filePath: '/path/b.ts', workingDirectory: '/path' });
        result.current.openLocalFile({ filePath: '/path/c.ts', workingDirectory: '/path' });
      });

      act(() => {
        result.current.closeRightLocalFileTabs('/path/a.ts');
      });

      expect(result.current.openLocalFiles.map((f) => f.filePath)).toEqual(['/path/a.ts']);
      expect(result.current.activeLocalFilePath).toBe('/path/a.ts');
    });
  });

  describe('closeOtherLocalFileTabs', () => {
    it('should close every tab except the target and activate it', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openLocalFile({ filePath: '/path/a.ts', workingDirectory: '/path' });
        result.current.openLocalFile({ filePath: '/path/b.ts', workingDirectory: '/path' });
        result.current.openLocalFile({ filePath: '/path/c.ts', workingDirectory: '/path' });
      });

      act(() => {
        result.current.closeOtherLocalFileTabs('/path/b.ts');
      });

      expect(result.current.openLocalFiles).toEqual([
        { filePath: '/path/b.ts', workingDirectory: '/path' },
      ]);
      expect(result.current.activeLocalFilePath).toBe('/path/b.ts');
      expect(result.current.portalStack[0]).toEqual({ type: PortalViewType.LocalFile });
    });
  });

  describe('setActiveLocalFile', () => {
    it('should update activeLocalFilePath', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openLocalFile({ filePath: '/path/a.ts', workingDirectory: '/path' });
        result.current.openLocalFile({ filePath: '/path/b.ts', workingDirectory: '/path' });
      });

      act(() => {
        result.current.setActiveLocalFile('/path/a.ts');
      });

      expect(result.current.activeLocalFilePath).toBe('/path/a.ts');
    });
  });

  describe('openToolUI', () => {
    it('should push ToolUI view and open portal', () => {
      const { result } = renderHook(() => useChatStore());

      expect(result.current.showPortal).toBe(false);

      act(() => {
        result.current.openToolUI('test-id', 'test-identifier');
      });

      expect(result.current.portalStack).toHaveLength(1);
      expect(result.current.portalStack[0]).toEqual({
        type: PortalViewType.ToolUI,
        messageId: 'test-id',
        identifier: 'test-identifier',
      });
      expect(result.current.showPortal).toBe(true);
    });

    it('should replace same type view on stack', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.openToolUI('test-id-1', 'identifier-1');
      });

      act(() => {
        result.current.openToolUI('test-id-2', 'identifier-2');
      });

      expect(result.current.portalStack).toHaveLength(1);
      expect(result.current.portalStack[0]).toEqual({
        type: PortalViewType.ToolUI,
        messageId: 'test-id-2',
        identifier: 'identifier-2',
      });
      expect(result.current.showPortal).toBe(true);
    });
  });
});

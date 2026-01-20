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

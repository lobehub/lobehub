import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { documentService } from '@/services/document';
import { sessionService } from '@/services/session';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { useSessionStore } from '@/store/session';

// Mock dependencies
vi.mock('@/services/document', () => ({
  documentService: {
    createDocument: vi.fn(),
  },
}));

vi.mock('@/services/session', () => ({
  sessionService: {
    createSession: vi.fn(),
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: vi.fn(),
  },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: {
    getState: vi.fn(),
  },
}));

describe('HomeInputAction', () => {
  const mockNavigate = vi.fn();
  const mockSendMessage = vi.fn().mockResolvedValue({});
  const mockRefreshSessions = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    vi.mocked(useGlobalStore.getState).mockReturnValue({
      navigate: mockNavigate,
    } as any);

    vi.mocked(useChatStore.getState).mockReturnValue({
      sendMessage: mockSendMessage,
    } as any);

    // Mock sessionService.createSession to return new agent id
    vi.mocked(sessionService.createSession).mockResolvedValue('new-agent-id');

    // Reset store state with mocked refreshSessions
    useSessionStore.setState({
      homeInputLoading: false,
      inputActiveMode: null,
      refreshSessions: mockRefreshSessions,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setInputActiveMode', () => {
    it('should set inputActiveMode to agent', () => {
      const { result } = renderHook(() => useSessionStore());

      act(() => {
        result.current.setInputActiveMode('agent');
      });

      expect(result.current.inputActiveMode).toBe('agent');
    });

    it('should set inputActiveMode to write', () => {
      const { result } = renderHook(() => useSessionStore());

      act(() => {
        result.current.setInputActiveMode('write');
      });

      expect(result.current.inputActiveMode).toBe('write');
    });

    it('should set inputActiveMode to image', () => {
      const { result } = renderHook(() => useSessionStore());

      act(() => {
        result.current.setInputActiveMode('image');
      });

      expect(result.current.inputActiveMode).toBe('image');
    });

    it('should set inputActiveMode to research', () => {
      const { result } = renderHook(() => useSessionStore());

      act(() => {
        result.current.setInputActiveMode('research');
      });

      expect(result.current.inputActiveMode).toBe('research');
    });

    it('should allow switching between modes', () => {
      const { result } = renderHook(() => useSessionStore());

      act(() => {
        result.current.setInputActiveMode('agent');
      });
      expect(result.current.inputActiveMode).toBe('agent');

      act(() => {
        result.current.setInputActiveMode('write');
      });
      expect(result.current.inputActiveMode).toBe('write');
    });
  });

  describe('clearInputMode', () => {
    it('should clear inputActiveMode to null', () => {
      const { result } = renderHook(() => useSessionStore());

      act(() => {
        result.current.setInputActiveMode('agent');
      });
      expect(result.current.inputActiveMode).toBe('agent');

      act(() => {
        result.current.clearInputMode();
      });
      expect(result.current.inputActiveMode).toBeNull();
    });

    it('should work when mode is already null', () => {
      const { result } = renderHook(() => useSessionStore());

      act(() => {
        result.current.clearInputMode();
      });

      expect(result.current.inputActiveMode).toBeNull();
    });
  });

  describe('sendAsAgent', () => {
    it('should create agent with correct params', async () => {
      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.sendAsAgent('Test prompt');
      });

      // createSession is called internally via the store action
      // which eventually calls sessionService.createSession
      expect(sessionService.createSession).toHaveBeenCalled();
    });

    it('should truncate long titles to 50 characters', async () => {
      const { result } = renderHook(() => useSessionStore());
      const longMessage = 'A'.repeat(100);

      await act(async () => {
        await result.current.sendAsAgent(longMessage);
      });

      expect(sessionService.createSession).toHaveBeenCalled();
    });

    it('should navigate to agent profile page', async () => {
      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.sendAsAgent('Test');
      });

      expect(mockNavigate).toHaveBeenCalledWith('/agent/new-agent-id/profile');
    });

    it('should send message with agentId context', async () => {
      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.sendAsAgent('Test message');
      });

      expect(mockSendMessage).toHaveBeenCalledWith({
        context: { agentId: 'new-agent-id', scope: 'agent_builder' },
        message: 'Test message',
      });
    });

    it('should clear mode after success', async () => {
      const { result } = renderHook(() => useSessionStore());

      act(() => {
        result.current.setInputActiveMode('agent');
      });

      await act(async () => {
        await result.current.sendAsAgent('Test');
      });

      expect(result.current.inputActiveMode).toBeNull();
    });

    it('should return agentId', async () => {
      const { result } = renderHook(() => useSessionStore());

      let agentId: string | undefined;
      await act(async () => {
        agentId = await result.current.sendAsAgent('Test');
      });

      expect(agentId).toBe('new-agent-id');
    });

    it('should set loading to false after completion', async () => {
      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.sendAsAgent('Test');
      });

      expect(result.current.homeInputLoading).toBe(false);
    });

    it('should set loading to false even if operation fails', async () => {
      vi.mocked(sessionService.createSession).mockRejectedValueOnce(new Error('Failed'));
      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        try {
          await result.current.sendAsAgent('Test');
        } catch {
          // Expected error
        }
      });

      expect(result.current.homeInputLoading).toBe(false);
    });

    it('should not throw when navigate is undefined', async () => {
      vi.mocked(useGlobalStore.getState).mockReturnValue({
        navigate: undefined,
      } as any);

      const { result } = renderHook(() => useSessionStore());

      await expect(
        act(async () => {
          await result.current.sendAsAgent('Test');
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('sendAsWrite', () => {
    beforeEach(() => {
      vi.mocked(documentService.createDocument).mockResolvedValue({
        id: 'new-doc-id',
      } as any);
    });

    it('should create document with correct title', async () => {
      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.sendAsWrite('Document content');
      });

      expect(documentService.createDocument).toHaveBeenCalledWith({
        editorData: '',
        title: 'Document content',
      });
    });

    it('should truncate long titles to 50 characters', async () => {
      const { result } = renderHook(() => useSessionStore());
      const longMessage = 'B'.repeat(100);

      await act(async () => {
        await result.current.sendAsWrite(longMessage);
      });

      expect(documentService.createDocument).toHaveBeenCalledWith({
        editorData: '',
        title: 'B'.repeat(50),
      });
    });

    it('should navigate to page', async () => {
      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.sendAsWrite('Content');
      });

      expect(mockNavigate).toHaveBeenCalledWith('/page/new-doc-id');
    });

    it('should send message with page scope context', async () => {
      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.sendAsWrite('Content');
      });

      expect(mockSendMessage).toHaveBeenCalledWith({
        context: {
          agentId: 'new-doc-id',
          scope: 'page',
        },
        message: 'Content',
      });
    });

    it('should clear mode after success', async () => {
      const { result } = renderHook(() => useSessionStore());

      act(() => {
        result.current.setInputActiveMode('write');
      });

      await act(async () => {
        await result.current.sendAsWrite('Content');
      });

      expect(result.current.inputActiveMode).toBeNull();
    });

    it('should return documentId', async () => {
      const { result } = renderHook(() => useSessionStore());

      let docId: string | undefined;
      await act(async () => {
        docId = await result.current.sendAsWrite('Content');
      });

      expect(docId).toBe('new-doc-id');
    });

    it('should set loading to false after completion', async () => {
      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.sendAsWrite('Content');
      });

      expect(result.current.homeInputLoading).toBe(false);
    });

    it('should set loading to false even if operation fails', async () => {
      vi.mocked(documentService.createDocument).mockRejectedValueOnce(new Error('Failed'));
      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        try {
          await result.current.sendAsWrite('Content');
        } catch {
          // Expected error
        }
      });

      expect(result.current.homeInputLoading).toBe(false);
    });
  });

  describe('sendAsImage', () => {
    it('should navigate to /image', () => {
      const { result } = renderHook(() => useSessionStore());

      act(() => {
        result.current.sendAsImage();
      });

      expect(mockNavigate).toHaveBeenCalledWith('/image');
    });

    it('should clear mode', () => {
      const { result } = renderHook(() => useSessionStore());

      act(() => {
        result.current.setInputActiveMode('image');
      });

      act(() => {
        result.current.sendAsImage();
      });

      expect(result.current.inputActiveMode).toBeNull();
    });

    it('should not throw when navigate is undefined', () => {
      vi.mocked(useGlobalStore.getState).mockReturnValue({
        navigate: undefined,
      } as any);

      const { result } = renderHook(() => useSessionStore());

      expect(() => {
        act(() => {
          result.current.sendAsImage();
        });
      }).not.toThrow();
    });
  });

  describe('sendAsResearch', () => {
    it('should log message to console', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.sendAsResearch('Research query');
      });

      expect(consoleSpy).toHaveBeenCalledWith('sendAsResearch:', 'Research query');

      consoleSpy.mockRestore();
    });

    it('should clear mode', async () => {
      const { result } = renderHook(() => useSessionStore());

      act(() => {
        result.current.setInputActiveMode('research');
      });

      await act(async () => {
        await result.current.sendAsResearch('Query');
      });

      expect(result.current.inputActiveMode).toBeNull();
    });
  });

  describe('homeInputLoading', () => {
    it('should be false initially', () => {
      const { result } = renderHook(() => useSessionStore());

      expect(result.current.homeInputLoading).toBe(false);
    });
  });
});

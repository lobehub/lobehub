import { toast } from '@lobehub/ui/base-ui';
import { act, renderHook } from '@testing-library/react';
import { type Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMediaUploadAbility } from '@/hooks/useMediaUploadAbility';
import { useAgentStore } from '@/store/agent';

import { getContainer, useDragUpload } from './useDragUpload';

// Mock the hooks and components
vi.mock('@/hooks/useMediaUploadAbility');
vi.mock('@/store/agent');
vi.mock('@lobehub/ui/base-ui', () => {
  return { toast: { warning: vi.fn() } };
});

describe('useDragUpload', () => {
  let mockOnUploadFiles: Mock;

  beforeEach(() => {
    mockOnUploadFiles = vi.fn();
    vi.useFakeTimers();
    document.body.innerHTML = '';

    // Mock the hooks
    (useMediaUploadAbility as Mock).mockReturnValue({
      canUploadImage: false,
      canUploadVideo: false,
    });
    (useAgentStore as unknown as Mock).mockImplementation((selector) =>
      selector({ activeAgentId: 'agent-1' }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should initialize and cleanup correctly', () => {
    const { result, unmount } = renderHook(() => useDragUpload(mockOnUploadFiles));

    expect(result.current).toBe(false);
    expect(document.getElementById('dragging-root')).not.toBeNull();

    unmount();

    expect(document.getElementById('dragging-root')).toBeNull();
  });

  it('should handle drag events correctly', () => {
    const { result } = renderHook(() => useDragUpload(mockOnUploadFiles));

    act(() => {
      window.dispatchEvent(new Event('dragenter'));
    });

    expect(result.current).toBe(false);

    act(() => {
      const dragEnterEvent = new Event('dragenter') as DragEvent;
      Object.defineProperty(dragEnterEvent, 'dataTransfer', {
        value: {
          items: [{}],
          types: ['Files'],
        },
      });
      window.dispatchEvent(dragEnterEvent);
    });

    expect(result.current).toBe(true);

    act(() => {
      const dragLeaveEvent = new Event('dragleave') as DragEvent;
      Object.defineProperty(dragLeaveEvent, 'dataTransfer', {
        value: {
          items: [{}],
          types: ['Files'],
        },
      });
      window.dispatchEvent(dragLeaveEvent);
    });

    expect(result.current).toBe(false);
  });

  it('should handle file drop', async () => {
    renderHook(() => useDragUpload(mockOnUploadFiles));

    const mockFile = new File([''], 'test.txt', { type: 'text/plain' });
    const dropEvent = new Event('drop') as DragEvent;
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        items: [
          {
            kind: 'file',
            getAsFile: () => mockFile,
            webkitGetAsEntry: () => ({
              isFile: true,
              file: (cb: (file: File) => void) => cb(mockFile),
            }),
          },
        ],
        types: ['Files'],
      },
    });

    await act(async () => {
      window.dispatchEvent(dropEvent);
    });

    expect(mockOnUploadFiles).toHaveBeenCalledWith([mockFile]);
  });

  it('should handle paste event', async () => {
    renderHook(() => useDragUpload(mockOnUploadFiles));

    const mockFile = new File([''], 'test.txt', { type: 'text/plain' });
    const pasteEvent = new Event('paste') as ClipboardEvent;
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        items: [
          {
            kind: 'file',
            getAsFile: () => mockFile,
            webkitGetAsEntry: () => null,
          },
        ],
      },
    });

    await act(async () => {
      window.dispatchEvent(pasteEvent);
    });

    expect(mockOnUploadFiles).toHaveBeenCalledWith([mockFile]);
  });

  it('should show warning when dropping image file with vision not supported', async () => {
    renderHook(() => useDragUpload(mockOnUploadFiles));

    const mockImageFile = new File([''], 'test.png', { type: 'image/png' });
    const dropEvent = new Event('drop') as DragEvent;
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        items: [
          {
            kind: 'file',
            getAsFile: () => mockImageFile,
            webkitGetAsEntry: () => ({
              isFile: true,
              file: (cb: (file: File) => void) => cb(mockImageFile),
            }),
          },
        ],
        types: ['Files'],
      },
    });

    await act(async () => {
      window.dispatchEvent(dropEvent);
    });

    expect(mockOnUploadFiles).not.toHaveBeenCalled();
  });

  it('should show warning when pasting image file with vision not supported', async () => {
    renderHook(() => useDragUpload(mockOnUploadFiles));

    const mockImageFile = new File([''], 'test.png', { type: 'image/png' });
    const pasteEvent = new Event('paste') as ClipboardEvent;
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        items: [
          {
            kind: 'file',
            getAsFile: () => mockImageFile,
            webkitGetAsEntry: () => null,
          },
        ],
      },
    });

    await act(async () => {
      window.dispatchEvent(pasteEvent);
    });

    expect(mockOnUploadFiles).not.toHaveBeenCalled();
  });

  it('should allow image files when vision is supported', async () => {
    (useMediaUploadAbility as Mock).mockReturnValue({
      canUploadImage: true,
      canUploadVideo: false,
    });

    renderHook(() => useDragUpload(mockOnUploadFiles));

    const mockImageFile = new File([''], 'test.png', { type: 'image/png' });
    const dropEvent = new Event('drop') as DragEvent;
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        items: [
          {
            kind: 'file',
            getAsFile: () => mockImageFile,
            webkitGetAsEntry: () => ({
              isFile: true,
              file: (cb: (file: File) => void) => cb(mockImageFile),
            }),
          },
        ],
        types: ['Files'],
      },
    });

    await act(async () => {
      window.dispatchEvent(dropEvent);
    });

    expect(mockOnUploadFiles).toHaveBeenCalledWith([mockImageFile]);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('should allow image files when visual understanding fallback is enabled', async () => {
    (useMediaUploadAbility as Mock).mockReturnValue({
      canUploadImage: true,
      canUploadVideo: true,
    });

    renderHook(() => useDragUpload(mockOnUploadFiles));

    const mockImageFile = new File([''], 'test.png', { type: 'image/png' });
    const pasteEvent = new Event('paste') as ClipboardEvent;
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        items: [
          {
            kind: 'file',
            getAsFile: () => mockImageFile,
            webkitGetAsEntry: () => null,
          },
        ],
      },
    });

    await act(async () => {
      window.dispatchEvent(pasteEvent);
    });

    expect(mockOnUploadFiles).toHaveBeenCalledWith([mockImageFile]);
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

describe('getContainer', () => {
  it('should return the dragging root element', () => {
    const rootElement = document.createElement('div');
    rootElement.id = 'dragging-root';
    document.body.appendChild(rootElement);

    const container = getContainer();
    expect(container).not.toBeNull();
    expect(container?.id).toBe('dragging-root');
  });
});

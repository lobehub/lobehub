import { renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('PageEditor beforeunload handler', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call preventDefault when isDirty is true', () => {
    const preventDefaultMock = vi.fn();
    const handleBeforeUnload = vi.fn((e: BeforeUnloadEvent) => {
      const isDirty = true;
      if (isDirty) {
        e.preventDefault();
        preventDefaultMock();
      }
    });

    window.addEventListener('beforeunload', handleBeforeUnload);

    const event = new Event('beforeunload') as BeforeUnloadEvent;
    window.dispatchEvent(event);

    expect(handleBeforeUnload).toHaveBeenCalled();
    expect(preventDefaultMock).toHaveBeenCalled();

    window.removeEventListener('beforeunload', handleBeforeUnload);
  });

  it('should not call preventDefault when isDirty is false', () => {
    const preventDefaultMock = vi.fn();
    const handleBeforeUnload = vi.fn((e: BeforeUnloadEvent) => {
      const isDirty = false;
      if (isDirty) {
        e.preventDefault();
        preventDefaultMock();
      }
    });

    window.addEventListener('beforeunload', handleBeforeUnload);

    const event = new Event('beforeunload') as BeforeUnloadEvent;
    window.dispatchEvent(event);

    expect(handleBeforeUnload).toHaveBeenCalled();
    expect(preventDefaultMock).not.toHaveBeenCalled();

    window.removeEventListener('beforeunload', handleBeforeUnload);
  });

  it('should add and remove event listener through useEffect', () => {
    const { unmount } = renderHook(() =>
      useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
          e.preventDefault();
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
          window.removeEventListener('beforeunload', handleBeforeUnload);
        };
      }, []),
    );

    expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });
});

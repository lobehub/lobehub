/**
 * @vitest-environment happy-dom
 */
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import UnsavedChangesGuard from './UnsavedChangesGuard';

const useBlockerMock = vi.hoisted(() => vi.fn());
const messageLoadingMock = vi.hoisted(() => vi.fn());
const messageDestroyMock = vi.hoisted(() => vi.fn());
const messageErrorMock = vi.hoisted(() => vi.fn());

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        destroy: messageDestroyMock,
        error: messageErrorMock,
        loading: messageLoadingMock,
      },
    }),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router-dom', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await vi.importActual('react-router-dom')) as typeof import('react-router-dom');

  return {
    ...actual,
    useBlocker: (shouldBlock: boolean) => useBlockerMock(shouldBlock),
  };
});

interface MockBlocker {
  proceed: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  state: 'blocked' | 'proceeding' | 'unblocked';
}

const createMockBlocker = (state: MockBlocker['state']): MockBlocker => ({
  proceed: vi.fn(),
  reset: vi.fn(),
  state,
});

const createBeforeUnloadEvent = () => {
  const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  Object.defineProperty(event, 'returnValue', {
    configurable: true,
    value: undefined,
    writable: true,
  });
  return event;
};

describe('UnsavedChangesGuard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useBlockerMock.mockReset();
    messageLoadingMock.mockReset();
    messageDestroyMock.mockReset();
    messageErrorMock.mockReset();
    useBlockerMock.mockReturnValue(createMockBlocker('unblocked'));
  });

  it('should auto-save and proceed when route is blocked', async () => {
    const blocker = createMockBlocker('blocked');
    const onAutoSave = vi.fn().mockResolvedValue(true);
    useBlockerMock.mockReturnValue(blocker);

    render(<UnsavedChangesGuard isDirty={true} message="unsaved" onAutoSave={onAutoSave} />);

    expect(useBlockerMock).toHaveBeenCalledWith(true);

    await waitFor(() => {
      expect(onAutoSave).toHaveBeenCalledTimes(1);
      expect(messageLoadingMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'pageEditor.saving', duration: 0 }),
      );
      expect(messageDestroyMock).toHaveBeenCalled();
      expect(blocker.proceed).toHaveBeenCalledTimes(1);
      expect(blocker.reset).not.toHaveBeenCalled();
    });
  });

  it('should reset navigation when auto-save fails', async () => {
    const blocker = createMockBlocker('blocked');
    const onAutoSave = vi.fn().mockResolvedValue(false);
    useBlockerMock.mockReturnValue(blocker);

    render(<UnsavedChangesGuard isDirty={true} message="unsaved" onAutoSave={onAutoSave} />);

    await waitFor(() => {
      expect(onAutoSave).toHaveBeenCalledTimes(1);
      expect(messageErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'networkError' }),
      );
      expect(blocker.reset).toHaveBeenCalledTimes(1);
      expect(blocker.proceed).not.toHaveBeenCalled();
    });
  });

  it('should reset navigation and show error when auto-save throws', async () => {
    const blocker = createMockBlocker('blocked');
    const onAutoSave = vi.fn().mockRejectedValue(new Error('save failed'));
    useBlockerMock.mockReturnValue(blocker);

    render(<UnsavedChangesGuard isDirty={true} message="unsaved" onAutoSave={onAutoSave} />);

    await waitFor(() => {
      expect(messageErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'save failed' }),
      );
      expect(blocker.reset).toHaveBeenCalledTimes(1);
      expect(blocker.proceed).not.toHaveBeenCalled();
    });
  });

  it('should only trigger beforeunload warning when dirty', () => {
    render(<UnsavedChangesGuard isDirty={true} message="unsaved" />);

    const dirtyEvent = createBeforeUnloadEvent();
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
    expect(dirtyEvent.returnValue).toBe('unsaved');
  });

  it('should not trigger beforeunload warning when clean', () => {
    render(<UnsavedChangesGuard isDirty={false} message="unsaved" />);

    const cleanEvent = createBeforeUnloadEvent();
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
    expect(cleanEvent.returnValue).toBeUndefined();
  });
});

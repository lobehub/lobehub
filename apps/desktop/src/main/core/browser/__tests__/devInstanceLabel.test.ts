import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  attachDevInstanceLabel,
  formatDevInstanceTitle,
  getDevInstanceLabel,
} from '../devInstanceLabel';

const { isDev } = vi.hoisted(() => ({ isDev: vi.fn(() => true) }));

vi.mock('@/utils/platform', () => ({ dev: isDev }));

afterEach(() => {
  isDev.mockReturnValue(true);
});

describe('getDevInstanceLabel', () => {
  it('returns the launcher label in dev builds', () => {
    expect(getDevInstanceLabel({ LOBE_DESKTOP_INSTANCE_LABEL: ' feature-x ' })).toBe('feature-x');
    expect(getDevInstanceLabel({ LOBE_DESKTOP_INSTANCE_LABEL: '  ' })).toBeUndefined();
    expect(getDevInstanceLabel({})).toBeUndefined();
  });

  it('never labels a packaged build', () => {
    isDev.mockReturnValue(false);

    expect(getDevInstanceLabel({ LOBE_DESKTOP_INSTANCE_LABEL: 'feature-x' })).toBeUndefined();
  });
});

describe('attachDevInstanceLabel', () => {
  const createWindow = () => {
    const listeners = new Map<string, (...args: any[]) => void>();
    const browserWindow = {
      setTitle: vi.fn(),
      webContents: {
        on: vi.fn((event: string, listener: (...args: any[]) => void) => {
          listeners.set(event, listener);
        }),
      },
    };
    return { browserWindow, listeners };
  };

  it('suffixes the native title instead of letting the page replace it', () => {
    const { browserWindow, listeners } = createWindow();
    attachDevInstanceLabel(browserWindow as any, 'feature-x');

    const event = { preventDefault: vi.fn() };
    listeners.get('page-title-updated')!(event, 'LobeHub');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(browserWindow.setTitle).toHaveBeenCalledWith('LobeHub — feature-x');
    expect(formatDevInstanceTitle('', 'feature-x')).toBe('feature-x');
  });

  /** Regression: an in-page badge covered the title bar of every window. */
  it('draws nothing over the page', () => {
    const { browserWindow, listeners } = createWindow();
    attachDevInstanceLabel(browserWindow as any, 'feature-x');

    expect([...listeners.keys()]).toEqual(['page-title-updated']);
  });
});

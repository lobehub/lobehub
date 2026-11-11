import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  attachDevInstanceLabel,
  buildDevInstanceBadgeScript,
  DEV_INSTANCE_BADGE_ID,
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
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
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

  it('injects the badge on every page load', () => {
    const { browserWindow, listeners } = createWindow();
    attachDevInstanceLabel(browserWindow as any, 'feature-x');

    listeners.get('dom-ready')!();

    expect(browserWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
      buildDevInstanceBadgeScript('feature-x'),
    );
  });

  it('sets the label as text so markup in a branch name is inert', () => {
    const script = buildDevInstanceBadgeScript('</script><img src=x onerror=alert(1)>');

    expect(script).toContain(`badge.textContent = "</script><img src=x onerror=alert(1)>"`);
    expect(script).not.toContain('innerHTML');
    expect(script).toContain(JSON.stringify(DEV_INSTANCE_BADGE_ID));
  });

  it('keeps the badge clear of the window controls drawn outside macOS', () => {
    expect(buildDevInstanceBadgeScript('x', 'darwin')).toContain(`right: '0px'`);
    expect(buildDevInstanceBadgeScript('x', 'win32')).toContain(`right: '140px'`);
  });
});

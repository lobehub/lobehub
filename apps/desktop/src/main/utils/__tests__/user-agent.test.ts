import { app } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { getDesktopUserAgent, setDesktopUserAgentHeader } from '../user-agent';

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.2.3'),
  },
}));

describe('user-agent utilities', () => {
  it('builds desktop user agent from Electron app version', () => {
    expect(getDesktopUserAgent()).toBe('LobeHub Desktop/1.2.3');
  });

  it('sets User-Agent on Headers', () => {
    const headers = new Headers({ 'user-agent': 'old' });

    setDesktopUserAgentHeader(headers);

    expect(headers.get('User-Agent')).toBe('LobeHub Desktop/1.2.3');
  });

  it('replaces case-insensitive User-Agent keys on plain objects', () => {
    const headers: Record<string, string> = { 'user-agent': 'old' };

    setDesktopUserAgentHeader(headers);

    expect(headers).toEqual({ 'User-Agent': 'LobeHub Desktop/1.2.3' });
    expect(app.getVersion).toHaveBeenCalled();
  });
});

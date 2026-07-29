import { beforeEach, describe, expect, it, vi } from 'vitest';

const { click, touch } = vi.hoisted(() => ({
  click: vi.fn().mockResolvedValue({ success: true }),
  touch: vi.fn(),
}));

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({ browserControl: { click } }),
}));

vi.mock('./browserWebviewRegistry', () => ({
  browserWebviewRegistry: { touch },
}));

describe('electronBrowserControlService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('touches the retained guest before a control call', async () => {
    const { electronBrowserControlService } = await import('./browserControl');

    await electronBrowserControlService.click({ ref: 'e1', sessionId: 'topic-1' });

    expect(touch).toHaveBeenCalledWith('topic-1');
    expect(click).toHaveBeenCalledWith({ ref: 'e1', sessionId: 'topic-1' });
    expect(touch.mock.invocationCallOrder[0]).toBeLessThan(click.mock.invocationCallOrder[0]);
  });
});

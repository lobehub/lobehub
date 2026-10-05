import { beforeEach, describe, expect, it, vi } from 'vitest';

const snapshot = vi.fn();

vi.mock('@/services/electron/browserControl', () => ({
  electronBrowserControlService: { snapshot },
}));

const ctx = { agentId: 'agt_1', topicId: 'tpc_1' } as any;

describe('browserExecutor.snapshot', () => {
  beforeEach(() => {
    snapshot.mockReset();
  });

  it('reports a page with no interactive elements as a successful, empty snapshot', async () => {
    // e.g. an image URL or a JSON API response: the page loaded fine, there is
    // just nothing to list.
    snapshot.mockResolvedValue({
      snapshot: '',
      success: true,
      title: 'api.printful.com/products/19',
      url: 'https://api.printful.com/products/19',
    });
    const { browserExecutor } = await import('./index');

    const result = await browserExecutor.snapshot({}, ctx);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.content).toContain(
      'Page: api.printful.com/products/19 (https://api.printful.com/products/19)',
    );
    expect(result.content).toContain('No interactive elements');
    expect(result.content).toContain('readPage');
  });

  it('still lists elements when the page has them', async () => {
    snapshot.mockResolvedValue({
      snapshot: '- button "Continue" [ref=e1]',
      success: true,
      title: 'Login',
      url: 'http://127.0.0.1:8099/login',
    });
    const { browserExecutor } = await import('./index');

    const result = await browserExecutor.snapshot({}, ctx);

    expect(result).toMatchObject({ success: true });
    expect(result.content).toBe(
      'Page: Login (http://127.0.0.1:8099/login)\n- button "Continue" [ref=e1]',
    );
  });

  it('keeps surfacing a real snapshot failure', async () => {
    snapshot.mockResolvedValue({
      error: 'Browser is not open for this conversation',
      success: false,
    });
    const { browserExecutor } = await import('./index');

    const result = await browserExecutor.snapshot({}, ctx);

    expect(result.success).toBe(false);
    expect(result.content).toBe('Browser is not open for this conversation');
  });
});

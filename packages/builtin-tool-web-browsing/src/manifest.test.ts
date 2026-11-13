import { describe, expect, it, vi } from 'vitest';

// One mutable clock controls both the module-load evaluation and the later
// reads, so the test can simulate a server process that started on one day and
// renders the system role on a later day.
const clock = { value: '2026-01-01' };

vi.mock('dayjs', () => ({
  default: () => ({ format: () => clock.value }),
}));

describe('WebBrowsingManifest.systemRole', () => {
  it('stamps the date that is current when the system role is read', async () => {
    vi.resetModules();
    const { WebBrowsingManifest } = await import('./manifest');

    // The manifest is a module-level singleton imported once when the process
    // starts; the system role it serves must not stay frozen on that day.
    expect(WebBrowsingManifest.systemRole).toContain('Current date: 2026-01-01');

    clock.value = '2026-11-06';
    expect(WebBrowsingManifest.systemRole).toContain('Current date: 2026-11-06');
  });

  it('keeps the manifest identifier intact', async () => {
    vi.resetModules();
    const { WebBrowsingManifest } = await import('./manifest');

    expect(WebBrowsingManifest.identifier).toBe('lobe-web-browsing');
    expect(WebBrowsingManifest.systemRole).toContain('Current date:');
  });
});

import { describe, expect, it, vi } from 'vitest';

import { createDryRunAudit, dryRunNeedsApproval } from './interventionAudit';

describe('dryRunNeedsApproval', () => {
  it('lets a closed draft (no credentials, no network) run unattended', () => {
    expect(dryRunNeedsApproval(null)).toBe(false);
    expect(dryRunNeedsApproval({})).toBe(false);
    expect(dryRunNeedsApproval({ env: [{ name: 'PLAIN' }], network: { allow: [] } })).toBe(false);
  });

  it('asks before running a draft that reads a connector credential', () => {
    expect(dryRunNeedsApproval({ env: [{ connector: 'github', name: 'GITHUB_TOKEN' }] })).toBe(
      true,
    );
  });

  it('asks before running a draft that reaches the network', () => {
    expect(dryRunNeedsApproval({ network: { allow: ['api.github.com'] } })).toBe(true);
  });
});

describe('createDryRunAudit', () => {
  it('reads the exact version the call names', async () => {
    const loadVersion = vi.fn(async () => ({ manifest: { network: { allow: ['x.dev'] } } }));
    const audit = createDryRunAudit({ loadVersion });

    expect(await audit({ versionId: 'v2', widgetId: 'w1' })).toBe(true);
    expect(loadVersion).toHaveBeenCalledWith('w1', 'v2');

    loadVersion.mockResolvedValueOnce({ manifest: null } as any);
    expect(await audit({ versionId: 'v3', widgetId: 'w1' })).toBe(false);
  });

  it('fails closed: no pinned version, no loader, unknown version or a lookup error ask the user', async () => {
    const loadVersion = vi.fn(async () => ({ manifest: null }));
    expect(await createDryRunAudit({ loadVersion })({ widgetId: 'w1' })).toBe(true);
    expect(loadVersion).not.toHaveBeenCalled();

    expect(await createDryRunAudit()({ versionId: 'v1', widgetId: 'w1' })).toBe(true);
    expect(
      await createDryRunAudit({ loadVersion: async () => undefined })({
        versionId: 'v1',
        widgetId: 'w1',
      }),
    ).toBe(true);
    expect(
      await createDryRunAudit({
        loadVersion: async () => {
          throw new Error('boom');
        },
      })({ versionId: 'v1', widgetId: 'w1' }),
    ).toBe(true);
  });
});

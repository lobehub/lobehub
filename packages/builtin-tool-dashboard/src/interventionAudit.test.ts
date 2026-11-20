import { describe, expect, it, vi } from 'vitest';

import {
  createDryRunAudit,
  dryRunAccessOf,
  dryRunNeedsApproval,
  isDryRunAccessGranted,
} from './interventionAudit';

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

const githubDraft = {
  env: [{ connector: 'github', name: 'GITHUB_TOKEN' }],
  network: { allow: ['api.github.com'] },
};
const grant = (patch: Record<string, unknown> = {}) => ({
  connectors: ['github'],
  grantedAt: '2026-10-25T00:00:00Z',
  hosts: ['api.github.com'],
  workspaceId: null,
  ...patch,
});

describe('dryRunAccessOf', () => {
  it('lists each connector and host once, hosts case-folded', () => {
    expect(
      dryRunAccessOf({
        env: [
          { connector: 'github', name: 'A' },
          { connector: 'github', name: 'B' },
          { name: 'PLAIN' },
        ],
        network: { allow: ['API.github.com', 'api.github.com'] },
      }),
    ).toEqual({ connectors: ['github'], hosts: ['api.github.com'] });
  });
});

describe('isDryRunAccessGranted', () => {
  it('covers a draft asking for the same or less access on the same level', () => {
    expect(isDryRunAccessGranted(githubDraft, [grant()], null)).toBe(true);
    expect(isDryRunAccessGranted({ network: { allow: ['api.github.com'] } }, [grant()], null)).toBe(
      true,
    );
  });

  it('asks again for a new host, a new connector or another level', () => {
    const extraHost = { ...githubDraft, network: { allow: ['api.github.com', 'evil.example'] } };
    expect(isDryRunAccessGranted(extraHost, [grant()], null)).toBe(false);
    const extraConnector = { ...githubDraft, env: [{ connector: 'linear', name: 'LINEAR' }] };
    expect(isDryRunAccessGranted(extraConnector, [grant()], null)).toBe(false);
    expect(isDryRunAccessGranted(githubDraft, [grant()], 'ws_1')).toBe(false);
    expect(isDryRunAccessGranted(githubDraft, [grant({ workspaceId: 'ws_1' })], null)).toBe(false);
  });

  it('never pools access from separate grants', () => {
    const grants = [grant({ hosts: [] }), grant({ connectors: [], hosts: ['api.github.com'] })];
    expect(isDryRunAccessGranted(githubDraft, grants, null)).toBe(false);
  });
});

describe('createDryRunAudit with grants', () => {
  const loadVersion = vi.fn(async () => ({ manifest: githubDraft, workspaceId: null }));

  it('runs a covered draft without asking', async () => {
    const audit = createDryRunAudit({ loadGrants: () => [grant()], loadVersion });
    expect(await audit({ versionId: 'v2', widgetId: 'w1' })).toBe(false);
  });

  it('asks when no grant covers the draft or the grants cannot be read', async () => {
    const uncovered = createDryRunAudit({ loadGrants: () => [], loadVersion });
    expect(await uncovered({ versionId: 'v2', widgetId: 'w1' })).toBe(true);

    const failing = createDryRunAudit({
      loadGrants: async () => {
        throw new Error('settings unavailable');
      },
      loadVersion,
    });
    expect(await failing({ versionId: 'v2', widgetId: 'w1' })).toBe(true);
  });
});

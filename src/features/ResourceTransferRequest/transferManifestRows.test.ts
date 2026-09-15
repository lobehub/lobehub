import { describe, expect, it } from 'vitest';

import type { TransferManifest } from '@/services/resourceTransferRequest';

import { buildTransferManifestRows } from './transferManifestRows';

const emptyManifest: TransferManifest = {
  botBindings: 0,
  botPlatforms: [],
  connectorsAffected: 0,
  cronJobs: 0,
  deviceBindingAffected: false,
  expertiseAffected: 0,
  groupsToLeave: 0,
  hiddenReferencedMember: false,
  knowledgeToDetach: 0,
  ownerId: 'user-1',
  projectsToLeave: 0,
  tasksToDetach: 0,
};

describe('buildTransferManifestRows', () => {
  it('produces no rows when the handover carries nothing beyond the resource', () => {
    // The caller renders nothing at all for this — an empty titled panel would
    // claim the transfer "includes" something.
    expect(buildTransferManifestRows(emptyManifest, 'initiator')).toEqual([]);
  });

  it('orders rows by impact: carried, then reset, then detached', () => {
    const rows = buildTransferManifestRows(
      {
        ...emptyManifest,
        botBindings: 2,
        botPlatforms: ['discord', 'telegram'],
        connectorsAffected: 1,
        cronJobs: 1,
        deviceBindingAffected: true,
        knowledgeToDetach: 1,
      },
      'initiator',
    );

    expect(rows.map((row) => row.impact)).toEqual([
      'carried',
      'carried',
      'reset',
      'reset',
      'detached',
    ]);
  });

  it('leads with the blocker, which is a refusal rather than an impact', () => {
    const rows = buildTransferManifestRows(
      { ...emptyManifest, cronJobs: 1, hiddenReferencedMember: true },
      'recipient',
    );

    expect(rows[0]).toMatchObject({ id: 'hiddenReferencedMember', impact: 'blocker' });
  });

  it("hides the counts that exist only to describe other members' resources from the recipient", () => {
    // tasks/groups/projects are all computed with a `<> recipientId` predicate,
    // so by construction none of them is the recipient's — showing them on the
    // incoming card spends attention on resources they will never own.
    const manifest = {
      ...emptyManifest,
      cronJobs: 1,
      groupsToLeave: 1,
      projectsToLeave: 1,
      tasksToDetach: 1,
    };

    expect(buildTransferManifestRows(manifest, 'recipient').map((row) => row.id)).toEqual([
      'cronJobs',
    ]);
    expect(buildTransferManifestRows(manifest, 'initiator').map((row) => row.id)).toEqual([
      'cronJobs',
      'tasksToDetach',
      'groupsToLeave',
      'projectsToLeave',
    ]);
  });

  it('leaves the recipient with nothing to read when only third-party fallout applies', () => {
    const rows = buildTransferManifestRows(
      { ...emptyManifest, groupsToLeave: 2, tasksToDetach: 3 },
      'recipient',
    );

    expect(rows).toEqual([]);
  });

  it('addresses each party in their own copy', () => {
    const manifest = { ...emptyManifest, cronJobs: 1 };

    expect(buildTransferManifestRows(manifest, 'initiator')[0].key).toBe(
      'transferRequest.manifestInitiator.cronJobs',
    );
    expect(buildTransferManifestRows(manifest, 'recipient')[0].key).toBe(
      'transferRequest.manifest.cronJobs',
    );
  });

  it('carries the bot platforms into the copy so the row names them', () => {
    const [row] = buildTransferManifestRows(
      { ...emptyManifest, botBindings: 2, botPlatforms: ['discord', 'telegram'] },
      'recipient',
    );

    expect(row.options).toEqual({ count: 2, platforms: 'discord, telegram' });
  });

  it('reports a device reset from the flag alone, with no count to interpolate', () => {
    const [row] = buildTransferManifestRows(
      { ...emptyManifest, deviceBindingAffected: true },
      'initiator',
    );

    expect(row).toMatchObject({ id: 'deviceBindingAffected', impact: 'reset', options: {} });
  });
});

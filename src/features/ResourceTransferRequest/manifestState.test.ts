import { describe, expect, it } from 'vitest';

import type { TransferManifest } from '@/services/resourceTransferRequest';

import { isTransferManifestActionable } from './manifestState';

const manifest = {
  botBindings: 0,
  botPlatforms: [],
  connectorsAffected: 0,
  cronJobs: 0,
  deviceBindingAffected: false,
  expertiseAffected: 0,
  groupsToLeave: 0,
  hiddenReferencedMember: false,
  knowledgeToDetach: 0,
  ownerId: 'owner-1',
  projectsToLeave: 0,
  tasksToDetach: 0,
} satisfies TransferManifest;

describe('isTransferManifestActionable', () => {
  it('allows the action only after a successful manifest without blockers', () => {
    expect(isTransferManifestActionable(manifest, undefined)).toBe(true);
  });

  it('blocks the action while the manifest is unavailable or failed', () => {
    expect(isTransferManifestActionable(undefined, undefined)).toBe(false);
    expect(isTransferManifestActionable(undefined, new Error('load failed'))).toBe(false);
    expect(isTransferManifestActionable(manifest, new Error('refresh failed'))).toBe(false);
  });

  it('blocks a group transfer containing an inaccessible private member', () => {
    expect(
      isTransferManifestActionable({ ...manifest, hiddenReferencedMember: true }, undefined),
    ).toBe(false);
  });
});

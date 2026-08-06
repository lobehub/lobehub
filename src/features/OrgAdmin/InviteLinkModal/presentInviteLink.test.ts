import { beforeEach, describe, expect, it, vi } from 'vitest';

import { presentInviteLink } from './presentInviteLink';

const createInviteLinkModal = vi.hoisted(() => vi.fn());

vi.mock('./createInviteLinkModal', () => ({
  createInviteLinkModal,
}));

describe('presentInviteLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the share modal with the inviteUrl from inviteMember', () => {
    const inviteUrl = 'https://app.example.com/invite/tok_abc123';

    presentInviteLink(inviteUrl);

    expect(createInviteLinkModal).toHaveBeenCalledTimes(1);
    expect(createInviteLinkModal).toHaveBeenCalledWith({ inviteUrl });
  });

  it('does not open a modal when inviteUrl is empty', () => {
    presentInviteLink('');

    expect(createInviteLinkModal).not.toHaveBeenCalled();
  });
});

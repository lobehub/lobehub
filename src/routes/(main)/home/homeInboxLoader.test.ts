import dayjs from 'dayjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { homeInboxLoader } from './homeInboxLoader';

const preHydrateInbox = vi.fn(async () => [true, true]);
const activeWorkspace = vi.hoisted(() => ({ slug: null as string | null }));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  getActiveWorkspaceSlug: () => activeWorkspace.slug,
}));

vi.mock('@/store/brief', () => ({
  getBriefStoreState: () => ({ preHydrateInbox }),
}));

beforeEach(() => {
  preHydrateInbox.mockClear();
  activeWorkspace.slug = null;
});

describe('homeInboxLoader', () => {
  it('seeds the inbox and today’s digest of the active scope', async () => {
    await expect(homeInboxLoader({ params: {} })).resolves.toBeNull();

    expect(preHydrateInbox).toHaveBeenCalledWith(dayjs().format('YYYY-MM-DD'));
  });

  it('seeds the inbox when the URL opens the workspace already active', async () => {
    activeWorkspace.slug = 'acme';

    await homeInboxLoader({ params: { workspaceSlug: 'acme' } });

    expect(preHydrateInbox).toHaveBeenCalledTimes(1);
  });

  // The scope still belongs to the workspace being left: seeding it would paint
  // another workspace's briefs.
  it('reads nothing while the URL enters another workspace', async () => {
    activeWorkspace.slug = 'acme';

    await homeInboxLoader({ params: { workspaceSlug: 'other' } });
    await homeInboxLoader({ params: {} });

    expect(preHydrateInbox).not.toHaveBeenCalled();
  });

  it('does not hold the route on a storage stall', async () => {
    preHydrateInbox.mockImplementationOnce(() => new Promise(() => {}));

    await expect(homeInboxLoader({ params: {} })).resolves.toBeNull();
  });
});

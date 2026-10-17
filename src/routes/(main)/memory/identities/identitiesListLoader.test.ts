import { beforeEach, describe, expect, it, vi } from 'vitest';

const preHydrateIdentities = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@/store/userMemory', () => ({
  getUserMemoryStoreState: () => ({ preHydrateIdentities }),
}));

const { identitiesListLoader } = await import('./identitiesListLoader');

describe('identitiesListLoader', () => {
  beforeEach(() => preHydrateIdentities.mockClear());

  it('pre-hydrates the unfiltered head page for a plain visit', async () => {
    await identitiesListLoader({ request: new Request('https://app.test/memory/identities') });

    expect(preHydrateIdentities).toHaveBeenCalledWith({
      pageSize: 12,
      q: undefined,
      types: undefined,
    });
  });

  it('pre-hydrates the filtered query a cold load of a filtered URL asks for', async () => {
    await identitiesListLoader({
      request: new Request('https://app.test/memory/identities?q=mentor&type=professional'),
    });

    expect(preHydrateIdentities).toHaveBeenCalledWith({
      pageSize: 12,
      q: 'mentor',
      types: ['professional'],
    });
  });

  it('treats the `all` type tab as no type filter', async () => {
    await identitiesListLoader({
      request: new Request('https://app.test/memory/identities?type=all'),
    });

    expect(preHydrateIdentities).toHaveBeenCalledWith(
      expect.objectContaining({ q: undefined, types: undefined }),
    );
  });
});
